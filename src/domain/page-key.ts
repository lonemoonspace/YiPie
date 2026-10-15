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
