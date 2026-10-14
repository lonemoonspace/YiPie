import { z } from 'zod';

/**
 * What the content script extracts from a page. It comes from the page's
 * renderer, so the background parses it with this schema before anything
 * else sees it. The bounds are a sanity check on that untrusted reply; the
 * content script cuts the text much shorter (platform/extract).
 */
export const PageContext = z.strictObject({
  title: z.string().max(2_000),
  url: z.string().max(8_000),
  /** The document's language tag, or empty when the page declares none. */
  lang: z.string().max(100),
  text: z.string().max(200_000),
  /** The text was cut short (see `MAX_PAGE_TEXT_LENGTH` in platform/extract). */
  truncated: z.boolean(),
});
export type PageContext = z.infer<typeof PageContext>;
