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
    .map((part) => normalize(part))
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
    const startPoint = haystack.point(start);
    const endPoint = haystack.point(end - 1);
    if (startPoint === null || endPoint === null) continue;
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

interface Haystack {
  text: string;
  /** Where the normalized character at `index` came from. */
  point(index: number): MappedPoint | null;
}

/**
 * Normalized text of every chunk, each character mapped back to its source.
 * A page can hold millions of characters and this runs in its renderer on
 * every click of a quote, so only where each chunk starts is kept; a
 * character is traced back to its source only for the few places that match.
 */
function normalizeChunks(chunks: readonly string[]): Haystack {
  const fold = createFolder();
  const parts: string[] = [];
  /** Where each chunk starts in the normalized text. */
  const starts: number[] = [];
  let length = 0;
  for (const chunk of chunks) {
    starts.push(length);
    for (let offset = 0; offset < chunk.length;) {
      const char = charAt(chunk, offset);
      const mapped = fold(char);
      if (mapped !== '') {
        parts.push(mapped);
        length += mapped.length;
      }
      offset += char.length;
    }
  }
  /**
   * Where the last trace stopped: the source character it found and where
   * that character starts in the normalized text. Matches come in order, so
   * the next trace in the same chunk usually picks up from here rather than
   * from the chunk's start, and a page that is one long text node is not
   * walked again for every match.
   */
  let cursor = { chunk: -1, offset: 0, at: 0 };
  return {
    text: parts.join(''),
    point(index) {
      if (index < 0 || index >= length) return null;
      // The last chunk that starts at or before `index`: empty chunks start
      // where the next one does, and are passed over.
      let low = 0;
      let high = starts.length - 1;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if ((starts[middle] ?? 0) <= index) low = middle;
        else high = middle - 1;
      }
      const chunk = chunks[low] ?? '';
      let { offset, at } =
        cursor.chunk === low && cursor.at <= index ? cursor : { offset: 0, at: starts[low] ?? 0 };
      while (offset < chunk.length) {
        const char = charAt(chunk, offset);
        const next = at + fold(char).length;
        if (next > index) {
          cursor = { chunk: low, offset, at };
          return { chunk: low, offset, length: char.length };
        }
        at = next;
        offset += char.length;
      }
      return null;
    },
  };
}

/** Text as matching sees it: whitespace dropped, NFKC, lower case. */
function normalize(source: string): string {
  const fold = createFolder();
  let text = '';
  for (let offset = 0; offset < source.length;) {
    const char = charAt(source, offset);
    text += fold(char);
    offset += char.length;
  }
  return text;
}

/** The code point of `text` at `offset`: one UTF-16 unit, or a surrogate pair. */
function charAt(text: string, offset: number): string {
  const code = text.charCodeAt(offset);
  if (code >= 0xd800 && code <= 0xdbff && offset + 1 < text.length) {
    const next = text.charCodeAt(offset + 1);
    if (next >= 0xdc00 && next <= 0xdfff) return text.slice(offset, offset + 2);
  }
  return text.charAt(offset);
}

/**
 * One character as matching sees it. ASCII, most of any page, is folded by
 * hand (NFKC leaves it as it is); anything else once per distinct character.
 */
function createFolder(): (char: string) => string {
  const seen = new Map<string, string>();
  return (char) => {
    const code = char.charCodeAt(0);
    if (code < 0x80) {
      if (code === 0x20 || (code >= 0x09 && code <= 0x0d)) return '';
      return code >= 0x41 && code <= 0x5a ? String.fromCharCode(code + 0x20) : char;
    }
    let mapped = seen.get(char);
    if (mapped === undefined) {
      mapped = char.normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
      seen.set(char, mapped);
    }
    return mapped;
  };
}
