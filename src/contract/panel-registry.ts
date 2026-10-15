import { z } from 'zod';
import { PANEL_MODES } from './rpc-wire';
import type { StorageKey } from './storage';

/**
 * Which panel each tab may have (docs/development-plan.md §2.1). Our content
 * script asks for a nonce when it mounts the panel frame and passes it in the
 * frame's URL; the panel presents it in `panel.attach`. Only the document that
 * presented the current nonce gets page data, so a `panel.html` embedded by
 * anyone else is refused even if its dynamic URL leaked.
 *
 * Lives in `storage.session`: in memory only, gone when the browser restarts,
 * and readable by extension pages and the service worker alone.
 */
export const PANEL_REGISTRY_KEY: StorageKey = 'session:panel-registry';
export const PANEL_REGISTRY_VERSION = 1;

/** Entries kept at most; the oldest go first. */
export const PANEL_REGISTRY_LIMIT = 50;

export const PanelEntry = z.object({
  nonce: z.string(),
  issuedAt: z.number(),
  /** `documentId` of the panel that presented the nonce, once one has. */
  attachedDocument: z.string().nullable(),
  /**
   * The page the panel was mounted on (`domain/page-key`), from the tab URL
   * the browser reported with our content script's request: the conversation
   * the panel restores and saves is this page's.
   */
  pageKey: z.string(),
  /** What the panel works on: the page, or the selection (§4.6). */
  mode: z.enum(PANEL_MODES).default('page'),
});
export type PanelEntry = z.infer<typeof PanelEntry>;

/** Keyed by tab id. */
export const PanelRegistry = z.record(z.string(), PanelEntry);
export type PanelRegistry = z.infer<typeof PanelRegistry>;
