import {
  GENERAL_SETTINGS_KEY,
  GENERAL_SETTINGS_VERSION,
  GeneralSettings,
  defaultGeneralSettings,
  type GeneralSettingsPatch,
} from '@/contract/general-settings';
import type { GeneralSettingsView, PanelSettings } from '@/contract/rpc';
import { resolveLocale } from '@/domain/i18n/locale';
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

export interface GeneralSettingsDeps {
  /** The browser's own language (`i18n.getUILanguage()`), which `auto` follows. */
  browserLanguage: () => string;
}

export function createGeneralSettingsService(
  store: StorageLike,
  queue: Queue,
  { browserLanguage }: GeneralSettingsDeps = { browserLanguage: () => 'zh-CN' },
): GeneralSettingsService {
  const repo = createRepo(store, queue, {
    key: GENERAL_SETTINGS_KEY,
    version: GENERAL_SETTINGS_VERSION,
    schema: GeneralSettings,
    defaults: defaultGeneralSettings,
  });

  /** What `auto` means is decided here, in the background, for every context. */
  const localeOf = (settings: GeneralSettings) =>
    resolveLocale(settings.interfaceLanguage, browserLanguage());

  const toView = (result: ReadResult<GeneralSettings>): GeneralSettingsView => {
    if (result.status === 'invalid') {
      // An unreadable value is shown as defaults, so the reason must be on record.
      logger.warn('General settings are unreadable:', result.reason, result.issues);
    }
    return {
      settings: result.value,
      status: result.status,
      readOnly: result.status === 'invalid' && result.readOnly,
      quarantined: false,
      locale: localeOf(result.value),
    };
  };

  return {
    async get() {
      return toView(await repo.read());
    },

    async patch(patch) {
      const { value, quarantined } = await repo.update((current) => applyPatch(current, patch));
      return {
        settings: value,
        status: 'ok',
        readOnly: false,
        quarantined,
        locale: localeOf(value),
      };
    },

    async current() {
      const { settings, locale } = toView(await repo.read());
      const { trimming, theme, fontSize, answerLanguage } = settings;
      return { trimming, theme, fontSize, answerLanguage, locale };
    },
  };
}
