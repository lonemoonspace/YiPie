import { findQuote } from '@/domain/citation';

/** Name of the highlight; the style comes from the background (`QUOTE_HIGHLIGHT_CSS`). */
export const QUOTE_HIGHLIGHT = 'yipie-quote';

/** Prefix of our host element's tag name (platform/panel-host). */
const HOST_TAG_PREFIX = 'yipie-panel-';

/** Text in these is never what a reader sees on the page. */
const SKIPPED = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA']);

/** The parts of the CSS Custom Highlight API we use. */
interface HighlightApi {
  highlights: { set(name: string, highlight: unknown): unknown; delete(name: string): unknown };
  create(range: Range): unknown;
}

function browserHighlights(): HighlightApi | null {
  const scope = globalThis as unknown as {
    CSS?: { highlights?: HighlightApi['highlights'] };
    Highlight?: new (range: Range) => unknown;
  };
  const { CSS: css, Highlight } = scope;
  if (css?.highlights === undefined || Highlight === undefined) return null;
  return { highlights: css.highlights, create: (range) => new Highlight(range) };
}

/**
 * Finds `quote` in the page, scrolls it into view and highlights it
 * (docs/development-plan.md §4.6). The highlight is a CSS Custom Highlight
 * over a range: the page's DOM is not changed. An earlier highlight goes;
 * when the quote is not found, nothing moves and false comes back. Of
 * several places, the first one that is shown wins.
 */
export function locateQuote(
  doc: Document,
  quote: string,
  api: HighlightApi | null = browserHighlights(),
): boolean {
  api?.highlights.delete(QUOTE_HIGHLIGHT);
  const nodes = textNodes(doc);
  const matches = findQuote(
    nodes.map((node) => node.data),
    quote,
  );
  for (const { start, end } of matches) {
    const first = nodes[start.chunk]!;
    const last = nodes[end.chunk]!;
    // A range lives in one tree: a passage that runs out of a shadow root or
    // a frame is marked up to where that tree ends.
    const together = first.getRootNode() === last.getRootNode();
    const range = (first.ownerDocument ?? doc).createRange();
    range.setStart(first, start.offset);
    if (together) range.setEnd(last, end.offset);
    else range.setEnd(first, first.length);
    if (!isShown(range)) continue;
    first.parentElement?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    // The style is in the page's document; a frame's own document has none.
    if (first.ownerDocument === doc) api?.highlights.set(QUOTE_HIGHLIGHT, api.create(range));
    return true;
  }
  return false;
}

/** Takes the highlight off the page: the panel that showed the quote has closed (#24). */
export function clearQuoteHighlight(api: HighlightApi | null = browserHighlights()): void {
  api?.highlights.delete(QUOTE_HIGHLIGHT);
}

/** How many open shadow roots or same-origin frames deep the search goes, as extraction does. */
const MAX_DEPTH = 3;

/**
 * The page's text nodes in the order they render, without our own host.
 * Like extraction (platform/extract/flatten.ts), the search goes into open
 * shadow roots, the light-DOM nodes their slots show, and same-origin
 * frames: a quote the model took from there is found there too (#24).
 */
function textNodes(doc: Document): Text[] {
  const nodes: Text[] = [];
  const children = (parent: Node, depth: number) => {
    for (const child of parent.childNodes) take(child, depth);
  };
  const take = (node: Node, depth: number): void => {
    // Nodes of a frame come from another realm: `instanceof` would not know them.
    if (node.nodeType === TEXT_NODE) {
      nodes.push(node as Text);
      return;
    }
    if (node.nodeType !== ELEMENT_NODE) return;
    const element = node as Element;
    if (SKIPPED.has(element.tagName.toUpperCase())) return;
    if (element.localName.startsWith(HOST_TAG_PREFIX)) return;
    if (element.localName === 'slot') {
      const assigned = (element as HTMLSlotElement).assignedNodes?.({ flatten: true }) ?? [];
      if (assigned.length > 0) {
        for (const slotted of assigned) take(slotted, depth);
        return;
      }
    }
    if (element.localName === 'iframe' || element.localName === 'frame') {
      const inner = sameOriginDocument(element as HTMLIFrameElement);
      if (inner?.body != null && depth < MAX_DEPTH) children(inner.body, depth + 1);
      return;
    }
    const shadow = element.shadowRoot;
    if (shadow !== null && depth < MAX_DEPTH) children(shadow, depth + 1);
    else children(element, depth);
  };
  if (doc.body !== null) children(doc.body, 0);
  return nodes;
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

function sameOriginDocument(frame: HTMLIFrameElement): Document | null {
  try {
    return frame.contentDocument;
  } catch {
    return null;
  }
}

/**
 * Whether a range is laid out on the page; hidden copies of a passage (a
 * collapsed menu, a template) are not. Without layout (tests), everything is.
 */
function isShown(range: Range): boolean {
  if (typeof range.getClientRects !== 'function') return true;
  const rects = range.getClientRects();
  return rects.length > 0 && [...rects].some((rect) => rect.width > 0 || rect.height > 0);
}
