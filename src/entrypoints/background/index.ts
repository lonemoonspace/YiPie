import { defineBackground } from 'wxt/utils/define-background';
import { createLogger, setLogLevel } from '@/platform/logger';
import { registerRpcServer } from '@/platform/rpc/server';
import { createGeneralSettingsService } from '@/platform/settings/general-settings-service';
import { ensureLocalStorageIsolated, getExtensionStore, writeQueue } from '@/platform/storage';

const logger = createLogger('background');

export default defineBackground(() => {
  const settings = createGeneralSettingsService(getExtensionStore(), writeQueue);

  // Register listeners first: the message being answered may be what woke this
  // worker. Handlers still wait until storage.local is closed to content scripts.
  registerRpcServer(
    {
      'settings.get': () => settings.get(),
      'settings.patch': async (patch) => {
        const view = await settings.patch(patch);
        setLogLevel(view.settings.logLevel);
        return view;
      },
    },
    { storageIsolated: ensureLocalStorageIsolated },
  );

  // Close storage.local now rather than on the first request. If the browser
  // refuses, RPC stays refused; each later request asks again.
  ensureLocalStorageIsolated().catch((error: unknown) => {
    logger.error('Could not restrict storage.local to extension pages:', error);
  });

  settings
    .get()
    .then((view) => setLogLevel(view.settings.logLevel))
    .catch((error: unknown) => logger.error('Could not read the log level:', error));
});
