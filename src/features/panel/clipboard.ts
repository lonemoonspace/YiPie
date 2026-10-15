/**
 * Copies an answer's Markdown. The host frame delegates `clipboard-write` to
 * the panel (platform/panel-host); a page that forbids it to its frames makes
 * this fail, and the panel says so.
 */
export function copyText(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}
