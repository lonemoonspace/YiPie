import type { Theme } from '@/contract/general-settings';

/** Selects the token set in tokens.css for the current page. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = theme;
}
