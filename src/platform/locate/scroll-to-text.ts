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
    const range = doc.createRange();
    range.setStart(nodes[start.chunk]!, start.offset);
    range.setEnd(nodes[end.chunk]!, end.offset);
    if (!isShown(range)) continue;
    const element = nodes[start.chunk]!.parentElement;
    element?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    api?.highlights.set(QUOTE_HIGHLIGHT, api.create(range));
    return true;
  }
  return false;
}

/** Takes the highlight off the page: the panel that showed the quote has closed (#24). */
export function clearQuoteHighlight(api: HighlightApi | null = browserHighlights()): void {
  api?.highlights.delete(QUOTE_HIGHLIGHT);
}

/** The page's text nodes in document order, without our own host. */
function textNodes(doc: Document): Text[] {
  const root = doc.body;
  if (root === null) return [];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      const element = node as Element;
      return SKIPPED.has(element.tagName) ||
        element.tagName.toLowerCase().startsWith(HOST_TAG_PREFIX)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_SKIP;
    },
  });
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    nodes.push(node as Text);
  }
  return nodes;
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
