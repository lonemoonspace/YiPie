/**
 * What travels over runtime messaging, as plain constants and types.
 *
 * Nothing here may import zod: the content script imports this file, and a
 * single runtime import of `rpc.ts` would pull zod and every schema into it
 * (docs/development-plan.md §2.2, §9). The schemas that validate these shapes
 * live in `rpc.ts` and run in the background.
 */

/** Marks requests to the background, so its listener can ignore everything else. */
export const RPC_CHANNEL = 'yipie.rpc/1';

export const RPC_ERROR_CODES = [
  'forbidden',
  'unknown-method',
  'bad-request',
  'not-found',
  'read-only',
  // The browser has not confirmed that storage.local is closed to content
  // scripts, so the background serves nothing (it fails closed).
  'storage-not-isolated',
  'internal',
] as const;
export type RpcErrorCode = (typeof RPC_ERROR_CODES)[number];

export interface RpcRequestWire {
  channel: typeof RPC_CHANNEL;
  method: string;
  input: unknown;
}

export type RpcReplyWire =
  { ok: true; value: unknown } | { ok: false; error: { code: RpcErrorCode; message: string } };

/**
 * Marks requests from the background to our content script in a tab (sent
 * with `tabs.sendMessage` to frame 0). The background validates every reply:
 * the content script runs in the page's renderer and is the least trusted
 * party in the conversation.
 */
export const PAGE_CHANNEL = 'yipie.page/1';

export type PageRequestWire =
  | { channel: typeof PAGE_CHANNEL; type: 'extract' }
  /** Find a quote in the page, scroll to it and highlight it; the reply's value is whether it was found. */
  | { channel: typeof PAGE_CHANNEL; type: 'locate'; quote: string };

export type PageReplyWire = { ok: true; value: unknown } | { ok: false; message: string };

/**
 * The languages the interface is written in (docs/development-plan.md §4.7).
 * The settings may also say `auto`, which the background resolves from the
 * browser's own language; what travels to the panel and the content script is
 * always one of these.
 */
export const LOCALES = ['zh-Hans', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * What the panel works on (docs/development-plan.md §4.6): the page, or the
 * text the user selected and asked about from the right-click menu.
 */
export const PANEL_MODES = ['page', 'selection'] as const;
export type PanelMode = (typeof PANEL_MODES)[number];

/**
 * Where the background leaves word of the trigger, in the content script's
 * isolated world, just before it injects the script (platform/inject): the
 * mode, and the selection as the right-click menu reported it.
 */
export const TRIGGER_SLOT = 'yipie.trigger';

export interface TriggerWire {
  mode: PanelMode;
  /** The menu's `selectionText`: a stand-in when the page's own selection reads empty. */
  selectionText: string;
}

/** What the slot holds: the trigger, and the interface language for the shell around the panel. */
export interface TriggerSlotWire extends TriggerWire {
  locale: Locale;
  /**
   * The page the trigger was on, as the tab's URL said then (`pageKeyOf`):
   * a single-page app may become another page before the panel mounts, and
   * a selection belongs to the page it was made on.
   */
  pageKey: string | null;
}
