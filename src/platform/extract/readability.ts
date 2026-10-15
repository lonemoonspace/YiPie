import { Readability } from '@mozilla/readability';
import type { PageContext } from '@/contract/page-context';
import { heuristicText } from './dom-heuristic';
import { flattenDocument } from './flatten';
import { tidy, textOf } from './text';

/**
 * Upper bound on the page text extracted, in characters: a sanity limit
 * (the contract allows no more). How much of it a request carries is decided
 * in the panel, from the model's context window and the trimming strategy
 * (docs/development-plan.md §4.4), which needs the whole text to keep its
 * end or its middle.
 */
export const MAX_PAGE_TEXT_LENGTH = 200_000;

/**
 * Text shorter than this (in characters) is not taken as the page's content
 * while another way might find more (docs/development-plan.md §4.6).
 */
export const SHORT_TEXT_LENGTH = 200;

/** Prefix of our host element's tag name (platform/panel-host). */
const HOST_TAG_PREFIX = 'yipie-panel-';

/** How the text was found, most specific first; for tests and the debug log. */
export type ExtractionMethod = 'readability' | 'heuristic' | 'flattened';

export interface Extracted {
  title: string;
  lang: string;
  text: string;
  method: ExtractionMethod;
}

/**
 * Extracts the readable text of `doc`, in steps (docs/development-plan.md
 * §4.6): Readability's article; when it finds none or a very short one, the
 * text the DOM heuristic finds; when that is still short, both again over a
 * copy that brings in open shadow roots and same-origin frames, whose text
 * is taken when it is longer. Each step runs on its own copy, since both
 * Readability and the heuristic rewrite the document they are given; our own
 * host is left out of every copy.
 */
export function extractText(doc: Document): Extracted {
  const title = doc.title.trim();
  const lang = doc.documentElement.lang.trim();
  let best = fromDocument(doc, title, lang);
  if (best.text.length >= SHORT_TEXT_LENGTH) return best;

  const { doc: flat, expanded } = flattenDocument(doc);
  if (expanded === 0) return best;
  const deeper = fromDocument(flat, title, lang);
  if (deeper.text.length > best.text.length) best = { ...deeper, method: 'flattened' };
  return best;
}

function fromDocument(doc: Document, title: string, lang: string): Extracted {
  const article = new Readability(copyOf(doc), { charThreshold: SHORT_TEXT_LENGTH }).parse();
  const readable: Extracted = {
    title: article?.title?.trim() || title,
    lang: article?.lang?.trim() || lang,
    text:
      article?.content != null
        ? tidy(textOf(new DOMParser().parseFromString(article.content, 'text/html').body))
        : '',
    method: 'readability',
  };
  if (readable.text.length >= SHORT_TEXT_LENGTH) return readable;

  // A short article is often what is left of the navigation; the heuristic
  // takes that out, so its text stands even when it is shorter or empty.
  return { ...readable, text: tidy(heuristicText(copyOf(doc))), method: 'heuristic' };
}

/** A copy to take apart, without our own host. */
function copyOf(doc: Document): Document {
  const clone = doc.cloneNode(true) as Document;
  for (const element of [...clone.documentElement.children]) {
    if (element.tagName.toLowerCase().startsWith(HOST_TAG_PREFIX)) element.remove();
  }
  return clone;
}

/**
 * The page as the panel gets it: the extracted text, cut at `limit`, and the
 * text selected when the panel was opened.
 */
export function extractPage(
  doc: Document,
  limit = MAX_PAGE_TEXT_LENGTH,
  selection = '',
): PageContext {
  const { title, lang, text } = extractText(doc);
  const truncated = text.length > limit;
  return {
    title,
    url: doc.URL,
    lang,
    text: truncated ? text.slice(0, limit) : text,
    selection: selection.slice(0, limit),
    truncated,
  };
}
