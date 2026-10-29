import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { TRIGGER_SLOT, type TriggerSlotWire } from '@/contract/rpc-wire';
import { setLocale } from '@/domain/i18n/content';
import { listenForPageRequests } from '@/platform/extract/listener';
import { rememberSelection } from '@/platform/extract/selection';
import { openPanelHost } from '@/platform/panel-host/host';

/**
 * Our content script. Injected on demand with `scripting.executeScript`, never
 * declared in the manifest, into the top frame of the tab the user triggered.
 * Runs in the extension's isolated world; each injection into the same
 * document reaches the same host and the same listener.
 *
 * Named `injected` rather than `content`: WXT treats `content.ts` as a
 * manifest-declared content script.
 */
export default defineUnlistedScript(() => {
  // Word of the trigger, left by the background just before this injection
  // (platform/inject); taken, so a later injection does not read it again.
  const scope = globalThis as unknown as Record<symbol, TriggerSlotWire | undefined>;
  const slot = Symbol.for(TRIGGER_SLOT);
  const trigger = scope[slot];
  scope[slot] = undefined;
  // Says to the background whether there is a panel: an SVG or XML file the
  // browser shows as such is no HTML document, and has no place for one (#29).
  // `executeScript` hands this return value back only because WXT builds the
  // script as an IIFE that returns what `main` returns (platform/inject).
  if (!(document.documentElement instanceof HTMLElement)) return false;

  // The shell speaks the interface language from the start; `content.hello`
  // brings it again for every later mount.
  if (trigger !== undefined) setLocale(trigger.locale);
  rememberSelection(trigger?.selectionText ?? '');
  listenForPageRequests();
  openPanelHost(trigger?.mode ?? 'page', trigger?.pageKey ?? null);
  return true;
});
