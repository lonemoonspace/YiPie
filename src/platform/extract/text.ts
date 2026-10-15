/**
 * Turning extracted DOM into the text a model reads: shared by every
 * extraction step (readability.ts, dom-heuristic.ts).
 */

const BLOCKS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DD',
  'DIV',
  'DL',
  'DT',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'FORM',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'SECTION',
  'TABLE',
  'TR',
  'UL',
]);

/**
 * Text with line breaks between blocks, headings marked with `#` and list
 * items with `- `, so the model still sees the document's structure.
 * Preformatted text keeps its whitespace.
 */
export function textOf(root: Element): string {
  const parts: string[] = [];
  const walk = (node: Node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        parts.push((child.textContent ?? '').replace(/\s+/g, ' '));
        continue;
      }
      if (!(child instanceof Element)) continue;
      const tag = child.tagName;
      if (tag === 'BR') {
        parts.push('\n');
      } else if (tag === 'PRE') {
        parts.push('\n\n', child.textContent ?? '', '\n\n');
      } else if (BLOCKS.has(tag)) {
        parts.push('\n\n');
        if (/^H[1-6]$/.test(tag)) parts.push(`${'#'.repeat(Number(tag[1]))} `);
        else if (tag === 'LI') parts.push('- ');
        walk(child);
        parts.push('\n\n');
      } else {
        walk(child);
      }
    }
  };
  walk(root);
  return parts.join('');
}

/** Trims each line and allows at most one blank line in a row. */
export function tidy(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
