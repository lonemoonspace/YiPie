import { browser } from 'wxt/browser';
import { welcomeHash, type StartPath } from '@/domain/welcome-hash';
import { createLogger } from '@/platform/logger';

const logger = createLogger('welcome');

/** The parts of `runtime` and `tabs` the first-run page needs. */
export interface WelcomeApi {
  onInstalled: (listener: (details: { reason: string }) => void) => void;
  /** Opens `hash` of the settings page in a new tab. */
  open: (hash: string) => Promise<unknown>;
}

const browserApi: WelcomeApi = {
  onInstalled: (listener) => browser.runtime.onInstalled.addListener(listener),
  // `tabs.create` needs no permission; the settings page's own URL with a hash
  // is how its first-run view is reached.
  open: (hash) => browser.tabs.create({ url: `${browser.runtime.getURL('/options.html')}${hash}` }),
};

/**
 * Opens the first-run page once, when the extension is installed
 * (docs/development-plan.md §4.8); not on an update or a browser update.
 * Call synchronously at service-worker start: the install event is what
 * wakes the worker the first time.
 */
export function openWelcomeOnInstall(api: WelcomeApi = browserApi): void {
  api.onInstalled(({ reason }) => {
    if (reason !== 'install') return;
    api.open(welcomeHash()).catch((error: unknown) => {
      logger.error('Could not open the first-run page:', error);
    });
  });
}

/**
 * Opens the first-run page on one of its ways in, from an extension page
 * (the panel, while no model is set up).
 */
export function openWelcomePage(path: StartPath, api: WelcomeApi = browserApi): Promise<void> {
  return api.open(welcomeHash(path)).then(() => undefined);
}
