import {
  GENERAL_SETTINGS_KEY,
  GENERAL_SETTINGS_VERSION,
  GeneralSettings,
  defaultGeneralSettings,
  type GeneralSettingsPatch,
} from '@/contract/general-settings';
import type { GeneralSettingsView, PanelSettings } from '@/contract/rpc';
import { applyPatch } from '@/domain/patch';
import { createLogger } from '@/platform/logger';
import { createRepo, type Queue, type ReadResult, type StorageLike } from '@/platform/storage';

const logger = createLogger('settings');

export interface GeneralSettingsService {
  get(): Promise<GeneralSettingsView>;
  /** Changes only the fields named in `patch`; runs in the shared write queue. */
  patch(patch: GeneralSettingsPatch): Promise<GeneralSettingsView>;
  /** What the panel uses, copied field by field. */
  current(): Promise<PanelSettings>;
}

export function createGeneralSettingsService(
  store: StorageLike,
  queue: Queue,
): GeneralSettingsService {
  const repo = createRepo(store, queue, {
    key: GENERAL_SETTINGS_KEY,
    version: GENERAL_SETTINGS_VERSION,
    schema: GeneralSettings,
    defaults: defaultGeneralSettings,
  });

  return {
    async get() {
      return toView(await repo.read());
    },

    async patch(patch) {
      const { value, quarantined } = await repo.update((current) => applyPatch(current, patch));
      return { settings: value, status: 'ok', readOnly: false, quarantined };
    },

    async current() {
      const { settings } = toView(await repo.read());
      return { trimming: settings.trimming };
    },
  };
}

function toView(result: ReadResult<GeneralSettings>): GeneralSettingsView {
  if (result.status === 'invalid') {
    // An unreadable value is shown as defaults, so the reason must be on record.
    logger.warn('General settings are unreadable:', result.reason, result.issues);
  }
  return {
    settings: result.value,
    status: result.status,
    readOnly: result.status === 'invalid' && result.readOnly,
    quarantined: false,
  };
}
