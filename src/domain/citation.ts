import type { Locale } from '@/contract/rpc-wire';

/**
 * Quotes of the page in model output (docs/development-plan.md §4.6). The
 * built-in prompt asks the model to back a point with a passage copied from
 * the page, written `[[passage]]`; the panel shows each as a marker that
 * finds the passage in the page.
 */

/** Longest passage taken as a quote; anything longer stays plain text. */
export const MAX_QUOTE_LENGTH = 500;

/** `[[passage]]` on one line, without brackets inside. */
export const CITATION = new RegExp(`\\[\\[([^\\[\\]\\n]{1,${MAX_QUOTE_LENGTH}})\\]\\]`);

const CITATIONS = new RegExp(CITATION.source, 'g');

/**
 * The text with each quote written as a plain quotation, for copying: 「passage」
 * in Chinese, “passage” in English.
 */
export function plainCitations(text: string, locale: Locale = 'zh-Hans'): string {
  const [open, close] = locale === 'en' ? ['“', '”'] : ['「', '」'];
  return text.replace(CITATIONS, (_, passage: string) => `${open}${passage.trim()}${close}`);
}

/** Where a match starts or ends: an offset into one of the chunks searched. */
export interface TextPoint {
  chunk: number;
  offset: number;
}

export interface QuoteMatch {
  start: TextPoint;
  /** Just past the last character. */
  end: TextPoint;
}

/** Ellipses a model writes where it left part of a passage out. */
const ELLIPSIS = /…+|\.{3,}|。{3,}/;

/**
 * Where `quote` occurs in the text made of `chunks` (the text nodes of a
 * page, in order), at most `limit` places. Matching forgives what copying
 * changes: whitespace (including where an element boundary falls),
 * letter case, and full-width forms (NFKC). A quote whose middle the model
 * left out with an ellipsis matches from its first part to its last, in
 * order and close together.
 */
export function findQuote(chunks: readonly string[], quote: string, limit = 20): QuoteMatch[] {
  const haystack = normalizeChunks(chunks);
  const parts = quote
    .split(ELLIPSIS)
    .map((part) => normalize(part).text)
    .filter((part) => part !== '');
  const first = parts[0];
  if (first === undefined) return [];
  // A passage the model shortened spans at most a few times what it wrote.
  const reach = parts.length > 1 ? Math.max(4 * quote.length, 400) : 0;

  const matches: QuoteMatch[] = [];
  let from = 0;
  while (matches.length < limit) {
    const start = haystack.text.indexOf(first, from);
    if (start === -1) break;
    from = start + 1;
    let end = start + first.length;
    if (parts.length > 1) {
      let cursor = end;
      let ok = true;
      for (const part of parts.slice(1)) {
        const at = haystack.text.indexOf(part, cursor);
        if (at === -1 || at + part.length - start > reach) {
          ok = false;
          break;
        }
        cursor = at + part.length;
      }
      if (!ok) continue;
      end = cursor;
    }
    const startPoint = haystack.points[start];
    const endPoint = haystack.points[end - 1];
    if (startPoint === undefined || endPoint === undefined) continue;
    matches.push({
      start: { chunk: startPoint.chunk, offset: startPoint.offset },
      end: { chunk: endPoint.chunk, offset: endPoint.offset + endPoint.length },
    });
  }
  return matches;
}

interface MappedPoint extends TextPoint {
  /** Length of the source character this normalized one came from. */
  length: number;
}

/** Normalized text of every chunk, each character mapped back to its source. */
function normalizeChunks(chunks: readonly string[]): { text: string; points: MappedPoint[] } {
  let text = '';
  const points: MappedPoint[] = [];
  chunks.forEach((chunk, index) => {
    const { text: part, origins } = normalize(chunk);
    text += part;
    for (const origin of origins) points.push({ chunk: index, ...origin });
  });
  return { text, points };
}

/**
 * Text as matching sees it, with where each of its characters came from:
 * whitespace dropped, NFKC, lower case. One source character (a code point)
 * may become several.
 */
function normalize(source: string): {
  text: string;
  origins: { offset: number; length: number }[];
} {
  let text = '';
  const origins: { offset: number; length: number }[] = [];
  let offset = 0;
  for (const char of source) {
    const mapped = char.normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
    for (let i = 0; i < mapped.length; i += 1) origins.push({ offset, length: char.length });
    text += mapped;
    offset += char.length;
  }
  return { text, origins };
}
