import { defineBackground } from 'wxt/utils/define-background';
import { createLogger, setLogLevel } from '@/platform/logger';
import { registerRpcServer } from '@/platform/rpc/server';
import { createGeneralSettingsService } from '@/platform/settings/general-settings-service';
import {
  getExtensionStore,
  restrictLocalStorageToExtensionPages,
  writeQueue,
} from '@/platform/storage';

const logger = createLogger('background');

export default defineBackground(() => {
  const settings = createGeneralSettingsService(getExtensionStore(), writeQueue);

  // Register listeners first: the message being answered may be what woke this worker.
  registerRpcServer({
    'settings.get': () => settings.get(),
    'settings.patch': async (patch) => {
      const view = await settings.patch(patch);
      setLogLevel(view.settings.logLevel);
      return view;
    },
  });

  restrictLocalStorageToExtensionPages().catch((error: unknown) => {
    logger.error('Could not restrict storage.local to extension pages:', error);
  });

  settings
    .get()
    .then((view) => setLogLevel(view.settings.logLevel))
    .catch((error: unknown) => logger.error('Could not read the log level:', error));
});
