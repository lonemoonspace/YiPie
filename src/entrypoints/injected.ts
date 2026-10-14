import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { listenForPageRequests } from '@/platform/extract/listener';
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
  listenForPageRequests();
  openPanelHost();
});
