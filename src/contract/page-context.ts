import { z } from 'zod';

/**
 * What the content script extracts from a page. It comes from the page's
 * renderer, so the background parses it with this schema before anything
 * else sees it.
 */
export const PageContext = z.strictObject({
  title: z.string(),
  url: z.string(),
  /** The document's language tag, or empty when the page declares none. */
  lang: z.string(),
  text: z.string(),
  /** The text was cut to `MAX_PAGE_TEXT_LENGTH` characters. */
  truncated: z.boolean(),
});
export type PageContext = z.infer<typeof PageContext>;

/**
 * Upper bound on the page text sent to a model in phase 1, in characters.
 * Phase 3 replaces it with a budget derived from the model's context window
 * (docs/development-plan.md §4.4).
 */
export const MAX_PAGE_TEXT_LENGTH = 60_000;
