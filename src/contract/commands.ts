/**
 * The keyboard command that opens the panel. Declared in the manifest
 * (wxt.config.ts) and handled in platform/triggers; one name for both.
 */
export const SUMMARIZE_COMMAND = 'summarize-page';

/** The right-click menu item that opens the panel (platform/triggers/context-menu). */
export const SUMMARIZE_MENU_ITEM = 'summarize-page';

/** The right-click menu item that summarizes the selected text (platform/triggers/context-menu). */
export const SUMMARIZE_SELECTION_MENU_ITEM = 'summarize-selection';
