import { describe, expect, it } from 'vitest';
import { GENERAL_SETTINGS_KEY } from '@/contract/general-settings';
import { createGeneralSettingsService } from '@/platform/settings/general-settings-service';
import { ReadOnlyRecordError, createQueue, readQuarantine } from '@/platform/storage';
import { createMemoryStore } from '../../helpers/memory-store';

function setup(stored?: unknown) {
  const store = createMemoryStore(stored === undefined ? {} : { [GENERAL_SETTINGS_KEY]: stored });
  return { store, settings: createGeneralSettingsService(store, createQueue()) };
}

describe('general settings service', () => {
  it('shows defaults for a fresh install', async () => {
    const { settings } = setup();

    expect(await settings.get()).toEqual({
      settings: {
        theme: 'system',
        logLevel: 'info',
        trimming: 'back',
        fontSize: 'medium',
        answerLanguage: 'interface',
        interfaceLanguage: 'auto',
      },
      status: 'missing',
      readOnly: false,
      quarantined: false,
      locale: 'zh-Hans',
    });
  });

  it('saving one field leaves every other field alone', async () => {
    // The phase-0 prototype reset the other fields here, because its patch
    // schema was `.partial()` of the stored one and kept the defaults.
    const { settings, store } = setup({
      version: 1,
      data: {
        theme: 'light',
        logLevel: 'debug',
        trimming: 'middle',
        fontSize: 'small',
        answerLanguage: 'en',
        interfaceLanguage: 'auto',
      },
    });

    await settings.patch({ theme: 'dark' });

    expect(store.dump()[GENERAL_SETTINGS_KEY]).toEqual({
      version: 1,
      data: {
        theme: 'dark',
        logLevel: 'debug',
        trimming: 'middle',
        fontSize: 'small',
        answerLanguage: 'en',
        interfaceLanguage: 'auto',
      },
    });
  });

  it('an empty patch changes nothing', async () => {
    const stored = {
      version: 1,
      data: {
        theme: 'light',
        logLevel: 'error',
        trimming: 'front',
        fontSize: 'x-large',
        answerLanguage: 'page',
        interfaceLanguage: 'auto',
      },
    };
    const { settings, store } = setup(stored);

    await settings.patch({});

    expect(store.dump()[GENERAL_SETTINGS_KEY]).toEqual(stored);
  });

  it('applies concurrent patches to different fields without losing either', async () => {
    const { settings } = setup();

    await Promise.all([
      settings.patch({ theme: 'dark' }),
      settings.patch({ logLevel: 'warn' }),
      settings.patch({ trimming: 'nothing' }),
      settings.patch({ fontSize: 'large' }),
    ]);

    expect((await settings.get()).settings).toEqual({
      theme: 'dark',
      logLevel: 'warn',
      trimming: 'nothing',
      fontSize: 'large',
      answerLanguage: 'interface',
      interfaceLanguage: 'auto',
    });
  });

  it('reports unreadable settings and backs them up on the next save', async () => {
    const broken = { version: 1, data: { theme: 42 } };
    const { settings, store } = setup(broken);

    const read = await settings.get();
    expect(read.status).toBe('invalid');
    expect(read.settings).toEqual({
      theme: 'system',
      logLevel: 'info',
      trimming: 'back',
      fontSize: 'medium',
      answerLanguage: 'interface',
      interfaceLanguage: 'auto',
    });

    const saved = await settings.patch({ theme: 'dark' });
    expect(saved.quarantined).toBe(true);
    expect((await readQuarantine(store, GENERAL_SETTINGS_KEY)).map((entry) => entry.raw)).toEqual([
      broken,
    ]);
  });

  it('shows settings from a newer version read-only and refuses to overwrite them', async () => {
    const newer = { version: 2, data: { theme: 'dark', logLevel: 'warn' } };
    const { settings, store } = setup(newer);

    const read = await settings.get();
    expect(read).toMatchObject({ readOnly: true, settings: { theme: 'dark', logLevel: 'warn' } });

    await expect(settings.patch({ theme: 'light' })).rejects.toBeInstanceOf(ReadOnlyRecordError);
    expect(store.dump()[GENERAL_SETTINGS_KEY]).toEqual(newer);
  });

  it('gives the panel only the fields it uses', async () => {
    const { settings } = setup({
      version: 1,
      data: {
        theme: 'dark',
        logLevel: 'warn',
        trimming: 'front',
        fontSize: 'large',
        answerLanguage: 'en',
        interfaceLanguage: 'en',
        density: 'compact',
      },
    });

    expect(await settings.current()).toEqual({
      trimming: 'front',
      theme: 'dark',
      fontSize: 'large',
      answerLanguage: 'en',
      locale: 'en',
    });
  });

  it('gives the panel the defaults when the stored value is unreadable', async () => {
    const { settings } = setup({ version: 1, data: { trimming: 'sideways' } });

    expect(await settings.current()).toEqual({
      trimming: 'back',
      theme: 'system',
      fontSize: 'medium',
      answerLanguage: 'interface',
      locale: 'zh-Hans',
    });
  });
});

describe('the interface language', () => {
  const stored = (interfaceLanguage: string) => ({
    version: 1,
    data: { interfaceLanguage },
  });
  const service = (value: unknown, browserLanguage: string) =>
    createGeneralSettingsService(
      createMemoryStore({ [GENERAL_SETTINGS_KEY]: value }),
      createQueue(),
      { browserLanguage: () => browserLanguage },
    );

  it('follows the browser while the settings say auto', async () => {
    expect((await service(stored('auto'), 'zh-TW').get()).locale).toBe('zh-Hans');
    expect((await service(stored('auto'), 'en-US').get()).locale).toBe('en');
    expect((await service(stored('auto'), 'fr').current()).locale).toBe('en');
  });

  it('is the one the settings name, whatever the browser speaks', async () => {
    expect((await service(stored('en'), 'zh-CN').current()).locale).toBe('en');
    expect((await service(stored('zh-Hans'), 'de').get()).locale).toBe('zh-Hans');
  });

  it('reports the language a change leads to', async () => {
    const settings = service(stored('auto'), 'zh-CN');
    expect((await settings.patch({ interfaceLanguage: 'en' })).locale).toBe('en');
    expect((await settings.patch({ interfaceLanguage: 'auto' })).locale).toBe('zh-Hans');
  });
});
