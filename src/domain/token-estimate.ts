/**
 * Conservative token estimate, used to budget what we send to a model.
 *
 * Exact counts need the provider's own tokenizer, which we deliberately do not
 * ship (D5 in docs/development-plan.md): a vocabulary is megabytes of static
 * data, and every OpenAI-compatible server may use a different one. Budgeting
 * only needs a figure at or above what common tokenizers produce; the
 * provider's `usage` replaces it once a response arrives.
 *
 * Rates are charged per Unicode code point. Counting UTF-16 units instead
 * would bill every emoji and other astral character twice.
 *
 * | Code points                                              | Tokens each |
 * | -------------------------------------------------------- | ----------- |
 * | ASCII                                                    | 1/3         |
 * | U+0080–U+07FF (Latin extended, Greek, Cyrillic, Arabic…) | 1/2         |
 * | CJK ideographs, kana, hangul, CJK punctuation, full-width | 1           |
 * | everything else (other scripts, symbols, emoji)          | 3/2         |
 *
 * English averages about four characters per token, so the ASCII rate already
 * leaves headroom.
 */
export function estimateTokens(text: string): number {
  let ascii = 0;
  // Everything outside ASCII is tallied in half tokens to stay in integers.
  let halves = 0;
  for (const char of text) {
    const [a, h] = costOf(char);
    ascii += a;
    halves += h;
  }
  return tokensOf(ascii, halves);
}

/**
 * How many code points from the start (or the end) of `codePoints` fit in
 * `limit` estimated tokens: the part kept has an `estimateTokens` of at most
 * `limit`. Trimming a page to a budget uses it, so the cut agrees with the
 * estimate exactly.
 */
export function fitTokens(
  codePoints: readonly string[],
  limit: number,
  from: 'start' | 'end',
): number {
  let ascii = 0;
  let halves = 0;
  let count = 0;
  while (count < codePoints.length) {
    const char = codePoints[from === 'start' ? count : codePoints.length - 1 - count] ?? '';
    const [a, h] = costOf(char);
    if (tokensOf(ascii + a, halves + h) > limit) break;
    ascii += a;
    halves += h;
    count += 1;
  }
  return count;
}

/** One code point's cost: `[ASCII characters, half tokens]`. */
function costOf(char: string): [number, number] {
  const codePoint = char.codePointAt(0) ?? 0;
  if (codePoint < 0x80) return [1, 0];
  if (codePoint < 0x800) return [0, 1];
  return [0, isCjk(codePoint) ? 2 : 3];
}

function tokensOf(ascii: number, halves: number): number {
  return Math.ceil(ascii / 3) + Math.ceil(halves / 2);
}

function isCjk(codePoint: number): boolean {
  return (
    (codePoint >= 0x3000 && codePoint <= 0x30ff) || // CJK punctuation, hiragana, katakana
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) || // CJK extension A
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) || // CJK unified ideographs
    (codePoint >= 0xac00 && codePoint <= 0xd7af) || // hangul syllables
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK compatibility ideographs
    (codePoint >= 0xff00 && codePoint <= 0xffef) || // half-width and full-width forms
    (codePoint >= 0x20000 && codePoint <= 0x3134f) // CJK extensions B–G
  );
}
