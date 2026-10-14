import { Readability } from '@mozilla/readability';
import type { PageContext } from '@/contract/page-context';

/**
 * Upper bound on the page text sent to a model in phase 1, in characters.
 * Phase 3 replaces it with a budget derived from the model's context window
 * (docs/development-plan.md §4.4).
 */
export const MAX_PAGE_TEXT_LENGTH = 60_000;

/** Prefix of our host element's tag name (platform/panel-host). */
const HOST_TAG_PREFIX = 'yipie-panel-';

/**
 * Extracts the readable text of `doc` with Readability, keeping paragraph and
 * list structure as line breaks. Readability rewrites the DOM it is given, so
 * it works on a clone; our own host is left out of it. When Readability finds
 * no article, the body's visible text stands in (phase 5 adds a proper
 * heuristic fallback).
 */
export function extractPage(doc: Document, limit = MAX_PAGE_TEXT_LENGTH): PageContext {
  const clone = doc.cloneNode(true) as Document;
  for (const element of [...clone.documentElement.children]) {
    if (element.tagName.toLowerCase().startsWith(HOST_TAG_PREFIX)) element.remove();
  }

  const article = new Readability(clone, { charThreshold: 200 }).parse();
  const raw =
    article?.content != null
      ? textOf(new DOMParser().parseFromString(article.content, 'text/html').body)
      : (doc.body?.innerText ?? doc.body?.textContent ?? '');
  const text = tidy(raw);
  const truncated = text.length > limit;

  return {
    title: (article?.title ?? doc.title).trim(),
    url: doc.URL,
    lang: (article?.lang ?? doc.documentElement.lang).trim(),
    text: truncated ? text.slice(0, limit) : text,
    truncated,
  };
}

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
