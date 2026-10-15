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
      },
      status: 'missing',
      readOnly: false,
      quarantined: false,
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
        density: 'compact',
      },
    });

    expect(await settings.current()).toEqual({
      trimming: 'front',
      theme: 'dark',
      fontSize: 'large',
      answerLanguage: 'en',
    });
  });

  it('gives the panel the defaults when the stored value is unreadable', async () => {
    const { settings } = setup({ version: 1, data: { trimming: 'sideways' } });

    expect(await settings.current()).toEqual({
      trimming: 'back',
      theme: 'system',
      fontSize: 'medium',
      answerLanguage: 'interface',
    });
  });
});
