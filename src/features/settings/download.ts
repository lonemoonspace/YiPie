/**
 * Saves `value` as a JSON file through the browser's own download, with no
 * extra permission: a link to an object URL, clicked.
 */
export function downloadJson(fileName: string, value: unknown): void {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // Long enough for the download to have started.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
