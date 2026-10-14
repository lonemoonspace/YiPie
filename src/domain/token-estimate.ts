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
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint < 0x80) ascii += 1;
    else if (codePoint < 0x800) halves += 1;
    else if (isCjk(codePoint)) halves += 2;
    else halves += 3;
  }

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
