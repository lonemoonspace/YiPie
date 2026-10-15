/**
 * The key a page's conversation is saved under (docs/development-plan.md
 * §4.4): its URL without the in-page anchor, so jumping to a heading or
 * following a table of contents is still the same page. A fragment that
 * starts with `/` or `!` is a hash route of a single-page app (`#/inbox`,
 * `#!/post/1`): it names another page, so it stays. A text fragment
 * (`#:~:text=…`) is never part of the key.
 */
export function pageKeyOf(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  const fragment = parsed.hash.slice(1).split(':~:')[0] ?? '';
  parsed.hash = fragment.startsWith('/') || fragment.startsWith('!') ? fragment : '';
  return parsed.href;
}

/**
 * The page our content script is on, from what the browser reports about a
 * message it sent: its tab's URL, which follows a single-page app's
 * `pushState` and hash changes, rather than its frame's, which stays the URL
 * the document loaded with. The frame's only when the browser gives no tab
 * URL; null when it gives neither.
 */
export function contentPageKey(
  tabUrl: string | undefined,
  frameUrl: string | undefined,
): string | null {
  const url = tabUrl !== undefined && tabUrl !== '' ? tabUrl : frameUrl;
  return url === undefined ? null : pageKeyOf(url);
}
