import type { FontSize, Theme } from '@/contract/general-settings';

/** Selects the token set in tokens.css for the current page. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = theme;
}

/** Selects the reading size in tokens.css (`--font-size-reading`). */
export function applyFontSize(size: FontSize, root: HTMLElement = document.documentElement): void {
  root.dataset.fontSize = size;
}
