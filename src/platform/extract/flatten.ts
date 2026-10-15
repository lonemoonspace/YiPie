/** Prefix of our host element's tag name (platform/panel-host). */
const HOST_TAG_PREFIX = 'yipie-panel-';

/** How many open shadow roots or same-origin frames deep the copy goes. */
export const MAX_FLATTEN_DEPTH = 3;
/** Nodes copied at most: a guard against pages that would make the copy huge. */
export const MAX_FLATTEN_NODES = 100_000;

export interface Flattened {
  doc: Document;
  /** Open shadow roots and same-origin frames whose content went into the copy. */
  expanded: number;
}

/**
 * A copy of `doc` in which what an open shadow root renders and what a
 * same-origin frame shows stand in the place of their host, so text that
 * lives there can be extracted (docs/development-plan.md §4.6). `cloneNode`
 * copies neither. A shadow root's slots take the light-DOM nodes assigned to
 * them, as they render. Closed shadow roots and cross-origin frames stay out
 * of reach, as they should; so does our own host.
 */
export function flattenDocument(doc: Document): Flattened {
  const out = doc.implementation.createHTMLDocument(doc.title);
  out.documentElement.lang = doc.documentElement.lang;
  let expanded = 0;
  let copied = 0;

  const copyChildren = (from: ParentNode, into: Node, depth: number) => {
    for (const child of from.childNodes) copy(child, into, depth);
  };

  const copy = (node: Node, into: Node, depth: number): void => {
    if (copied >= MAX_FLATTEN_NODES) return;
    copied += 1;
    // Nodes of a frame come from another realm: `instanceof` would not know them.
    if (node.nodeType === TEXT_NODE) {
      into.appendChild(out.createTextNode(node.textContent ?? ''));
      return;
    }
    if (node.nodeType !== ELEMENT_NODE) return;
    const element = node as Element;
    const tag = element.localName;
    if (tag.startsWith(HOST_TAG_PREFIX)) return;

    if (tag === 'slot') {
      const assigned = (element as HTMLSlotElement).assignedNodes?.({ flatten: true }) ?? [];
      if (assigned.length > 0) {
        for (const slotted of assigned) copy(slotted, into, depth);
        return;
      }
    }

    if (tag === 'iframe' || tag === 'frame') {
      const inner = sameOriginDocument(element as HTMLIFrameElement);
      if (inner?.body != null && depth < MAX_FLATTEN_DEPTH) {
        expanded += 1;
        const box = out.createElement('div');
        into.appendChild(box);
        copyChildren(inner.body, box, depth + 1);
      }
      return;
    }

    const clone = out.importNode(element, false);
    into.appendChild(clone);
    const shadow = element.shadowRoot;
    if (shadow !== null && depth < MAX_FLATTEN_DEPTH) {
      expanded += 1;
      copyChildren(shadow, clone, depth + 1);
    } else {
      copyChildren(element, clone, depth);
    }
  };

  if (doc.body !== null) copyChildren(doc.body, out.body, 0);
  return { doc: out, expanded };
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/** The document of a frame showing a page of the same origin; null otherwise. */
function sameOriginDocument(frame: HTMLIFrameElement): Document | null {
  try {
    return frame.contentDocument;
  } catch {
    return null;
  }
}
