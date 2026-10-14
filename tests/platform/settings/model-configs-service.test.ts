import { describe, expect, it, vi } from 'vitest';
import { MODEL_CONFIGS_KEY, ModelConfigDraft } from '@/contract/model-config';
import { SELECTION_KEY } from '@/contract/selection';
import { NotFoundError } from '@/platform/settings/errors';
import { createModelConfigsService } from '@/platform/settings/model-configs-service';
import { createQueue, readQuarantine } from '@/platform/storage';
import { createMemoryStore } from '../../helpers/memory-store';

function setup(stored: Record<string, unknown> = {}) {
  const store = createMemoryStore(stored);
  let next = 0;
  const release = vi.fn((patterns: string[]) => Promise.resolve(patterns));
  const models = createModelConfigsService(store, createQueue(), {
    newId: () => `id-${++next}`,
    release,
  });
  return { store, models, release };
}

const draft = (fields: Record<string, unknown>) => ModelConfigDraft.parse(fields);

const config = (id: string, baseURL: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: '',
  baseURL,
  apiKey: '',
  model: `model-${id}`,
  headers: {},
  extraBody: {},
  contextWindow: null,
  streamUsage: true,
  ...extra,
});

const a = config('a', 'https://a.example/v1');
const b = config('b', 'https://shared.example/v1');
const c = config('c', 'https://shared.example/other');

/** Storage holding `configs`, and `defaultModelId` as the stored default. */
const stored = (configs: unknown[], defaultModelId: string | null = null) => ({
  [MODEL_CONFIGS_KEY]: { version: 1, data: configs },
  [SELECTION_KEY]: { version: 1, data: { defaultModelId, defaultPromptId: null } },
});

describe('model configurations service: reading', () => {
  it('starts with an empty list and no default', async () => {
    const { models } = setup();
    expect(await models.list()).toEqual({
      items: [],
      defaultId: null,
      status: 'missing',
      readOnly: false,
      quarantined: false,
    });
  });

  it('shows the first configuration as the default when none was chosen', async () => {
    const { models } = setup({ [MODEL_CONFIGS_KEY]: { version: 1, data: [a, b] } });
    expect(await models.list()).toMatchObject({ items: [a, b], defaultId: 'a' });
  });

  it('leaves a dirty row out of the list, and writes it back after a change', async () => {
    const { models, store } = setup(stored([a, { foo: 1 }, b], 'b'));

    expect(await models.list()).toMatchObject({ items: [a, b], defaultId: 'b', status: 'ok' });

    await models.update('a', { name: '改名' });
    expect(store.dump()[MODEL_CONFIGS_KEY]).toEqual({
      version: 1,
      data: [{ ...a, name: '改名' }, b, { foo: 1 }],
    });
  });

  it('backs up a value that is not a list before the next save replaces it', async () => {
    const broken = { version: 1, data: { not: 'a list' } };
    const { models, store } = setup({ [MODEL_CONFIGS_KEY]: broken });

    expect(await models.list()).toMatchObject({ status: 'invalid', items: [] });

    const saved = await models.add(draft({ baseURL: 'http://localhost:11434/v1', model: 'm' }));
    expect(saved.quarantined).toBe(true);
    expect(await readQuarantine(store, MODEL_CONFIGS_KEY)).toEqual([
      expect.objectContaining({ key: MODEL_CONFIGS_KEY, raw: broken }),
    ]);
  });
});

describe('model configurations service: changes', () => {
  it('adds a configuration with a fresh id, and makes the first one the default', async () => {
    const { models, store } = setup();

    const view = await models.add(
      draft({ name: '本地', baseURL: 'http://localhost:11434/v1', model: 'qwen2.5:7b' }),
    );

    const added = {
      ...config('id-1', 'http://localhost:11434/v1'),
      name: '本地',
      model: 'qwen2.5:7b',
    };
    expect(view).toEqual({
      items: [added],
      defaultId: 'id-1',
      status: 'ok',
      readOnly: false,
      quarantined: false,
      fallback: null,
      released: [],
    });
    expect(store.dump()).toEqual({
      [MODEL_CONFIGS_KEY]: { version: 1, data: [added] },
      [SELECTION_KEY]: { version: 1, data: { defaultModelId: 'id-1', defaultPromptId: null } },
    });
  });

  it('updates only the fields named in the patch, of only that configuration', async () => {
    const { models, store } = setup(stored([{ ...a, apiKey: 'keep-me' }, b]));

    await models.update('a', { model: 'llama3.1:8b' });

    expect(store.dump()[MODEL_CONFIGS_KEY]).toEqual({
      version: 1,
      data: [{ ...a, apiKey: 'keep-me', model: 'llama3.1:8b' }, b],
    });
  });

  it('keeps fields a newer version added when it saves', async () => {
    const { models, store } = setup(stored([{ ...a, future: { x: 1 } }]));

    await models.update('a', { name: '改名' });

    expect(store.dump()[MODEL_CONFIGS_KEY]).toEqual({
      version: 1,
      data: [{ ...a, name: '改名', future: { x: 1 } }],
    });
  });

  it('moves a configuration and keeps the default where it was', async () => {
    const { models } = setup(stored([a, b, c], 'b'));

    const view = await models.move('c', 0);

    expect(view.items.map((item) => item.id)).toEqual(['c', 'a', 'b']);
    expect(view.defaultId).toBe('b');
  });

  it('sets the default, and refuses an id that is not in the list', async () => {
    const { models, store } = setup(stored([a, b], 'a'));

    expect(await models.setDefault('b')).toBe('b');
    expect(store.dump()[SELECTION_KEY]).toEqual({
      version: 1,
      data: { defaultModelId: 'b', defaultPromptId: null },
    });
    await expect(models.setDefault('nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses to change an id that is not in the list, and writes nothing', async () => {
    const initial = stored([a]);
    const { models, store } = setup(initial);

    await expect(models.update('nope', { model: 'x' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(models.remove('nope')).rejects.toBeInstanceOf(NotFoundError);
    await expect(models.move('nope', 0)).rejects.toBeInstanceOf(NotFoundError);
    expect(store.dump()).toEqual(initial);
  });
});

describe('model configurations service: removing', () => {
  it('falls back to the first configuration when the default is removed, and says so', async () => {
    const { models, store } = setup(stored([a, b, c], 'b'));

    const view = await models.remove('b');

    expect(view).toMatchObject({
      defaultId: 'a',
      fallback: { from: { id: 'b', name: 'model-b' }, to: { id: 'a', name: 'model-a' } },
    });
    expect(store.dump()[SELECTION_KEY]).toEqual({
      version: 1,
      data: { defaultModelId: 'a', defaultPromptId: null },
    });
  });

  it('has no default after the last configuration is removed', async () => {
    const { models } = setup(stored([a], 'a'));

    expect(await models.remove('a')).toMatchObject({
      items: [],
      defaultId: null,
      fallback: { from: { id: 'a' }, to: null },
    });
  });

  it('says nothing when another configuration is removed', async () => {
    const { models } = setup(stored([a, b], 'a'));
    expect(await models.remove('b')).toMatchObject({ defaultId: 'a', fallback: null });
  });

  it('keeps an origin another configuration still uses, and gives back an unused one', async () => {
    const { models, release } = setup(stored([a, b, c]));

    expect(await models.remove('b')).toMatchObject({ released: [] });
    expect(release).not.toHaveBeenCalled();

    expect(await models.remove('c')).toMatchObject({ released: ['https://shared.example/*'] });
    expect(release).toHaveBeenCalledWith(['https://shared.example/*']);
  });

  it('gives back the old origin when a base URL moves to another one', async () => {
    const { models, release } = setup(stored([a]));

    await models.update('a', { baseURL: 'https://new.example/v1' });

    expect(release).toHaveBeenCalledWith(['https://a.example/*']);
  });

  it('reports only what the browser actually gave back', async () => {
    const { models } = setup(stored([a]));
    const store = createMemoryStore(stored([a]));
    const quiet = createModelConfigsService(store, createQueue(), {
      release: () => Promise.resolve([]),
    });

    expect(await quiet.remove('a')).toMatchObject({ released: [] });
    expect(await models.remove('a')).toMatchObject({ released: ['https://a.example/*'] });
  });
});

describe('model configurations service: concurrency', () => {
  it('keeps both of two concurrent additions', async () => {
    const { models } = setup();

    await Promise.all([
      models.add(draft({ baseURL: 'https://a.example/v1', model: 'a' })),
      models.add(draft({ baseURL: 'https://b.example/v1', model: 'b' })),
    ]);

    expect((await models.list()).items.map((item) => item.model).sort()).toEqual(['a', 'b']);
  });

  it('loses nothing when the settings page and the panel change things at once', async () => {
    const { models } = setup(stored([a, b], 'a'));

    // The settings page adds and renames; the panel switches the default.
    await Promise.all([
      models.add(draft({ baseURL: 'https://d.example/v1', model: 'd' })),
      models.setDefault('b'),
      models.update('a', { name: '改名' }),
      models.move('b', 0),
    ]);

    const view = await models.list();
    expect(view.items.map((item) => item.id)).toEqual(['b', 'a', 'id-1']);
    expect(view.items[1]?.name).toBe('改名');
    expect(view.defaultId).toBe('b');
  });
});

describe('model configurations service: a selection written by a newer version', () => {
  it('leaves it untouched, and still changes the list', async () => {
    const newer = { version: 2, data: { defaultModelId: 'a' } };
    const { models, store } = setup({
      [MODEL_CONFIGS_KEY]: { version: 1, data: [a, b] },
      [SELECTION_KEY]: newer,
    });

    expect(await models.remove('a')).toMatchObject({ items: [b] });
    expect(store.dump()[SELECTION_KEY]).toEqual(newer);
    await expect(models.setDefault('b')).rejects.toThrow(/newer version/);
  });
});
