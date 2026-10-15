/**
 * The selection when the panel was last opened, kept on the isolated world's
 * global object: every injection into this document shares it, while each
 * injection evaluates its own copy of this module.
 */
const SLOT = Symbol.for('yipie.selection');

/**
 * Remembers what is selected in the page now, at the moment of the trigger:
 * the user may click elsewhere before the panel asks. `fallback` (what the
 * right-click menu reported) stands in when the page's own selection reads
 * empty, as it does for text selected in a form field.
 */
export function rememberSelection(fallback: string): void {
  const selected = (globalThis.getSelection?.()?.toString() ?? '').trim();
  (globalThis as unknown as Record<symbol, string>)[SLOT] = selected || fallback.trim();
}

/** The selection remembered when the panel was last opened; empty when none. */
export function rememberedSelection(): string {
  return (globalThis as unknown as Record<symbol, string | undefined>)[SLOT] ?? '';
}
