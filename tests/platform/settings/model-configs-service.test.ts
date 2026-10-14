import { describe, expect, it, vi } from 'vitest';
import { MODEL_CONFIGS_KEY, ModelConfigDraft } from '@/contract/model-config';
import { SELECTION_KEY } from '@/contract/selection';
import { NotFoundError } from '@/platform/settings/errors';
import { createModelConfigsService } from '@/platform/settings/model-configs-service';
import { ReadOnlyRecordError, createQueue, readQuarantine } from '@/platform/storage';
import { createMemoryStore } from '../../helpers/memory-store';

function setup(stored: Record<string, unknown> = {}) {
  const store = createMemoryStore(stored);
  let next = 0;
  const released: string[] = [];
  const releaseOrigins = vi.fn((patterns: string[]) => {
    released.push(...patterns);
    return Promise.resolve();
  });
  const models = createModelConfigsService(store, createQueue(), {
    newId: () => `id-${++next}`,
    releaseOrigins,
  });
  return { store, models, releaseOrigins, released };
}

const draft = (fields: Record<string, unknown>) => ModelConfigDraft.parse(fields);
const list = (...data: unknown[]) => ({ [MODEL_CONFIGS_KEY]: { version: 1, data } });

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

const ollama = config('id-1', 'http://localhost:11434/v1', { name: '本地', model: 'qwen2.5:7b' });
const openai = config('a', 'https://api.openai.com/v1');
const deepseek = config('b', 'https://api.deepseek.com/v1');
const gateway = config('c', 'https://gw.example/v1');

const ids = (view: { items: { id: string }[] }) => view.items.map((item) => item.id);

describe('model configurations: reading', () => {
  it('starts with an empty list and no default', async () => {
    const { models } = setup();
    expect(await models.list()).toEqual({
      items: [],
      defaultId: null,
      unrecognized: 0,
      status: 'missing',
      readOnly: false,
      quarantined: false,
      defaultFellBack: false,
      defaultUnreadable: false,
    });
  });

  it('sets aside a row it cannot read, never shows it, and keeps it on the next write', async () => {
    const dirty = { foo: 1 };
    const { models, store } = setup(list(dirty, openai));

    const read = await models.list();
    expect(read).toMatchObject({ status: 'ok', unrecognized: 1, defaultId: 'a' });
    expect(ids(read)).toEqual(['a']);

    await models.update('a', { name: '改名' });

    expect(store.dump()[MODEL_CONFIGS_KEY]).toEqual({
      version: 1,
      data: [{ ...openai, name: '改名' }, dirty],
    });
  });

  it('backs up a value that is not a list before the next save replaces it', async () => {
    const broken = { version: 1, data: { configs: [openai] } };
    const { models, store } = setup({ [MODEL_CONFIGS_KEY]: broken });

    expect(await models.list()).toMatchObject({ status: 'invalid', items: [] });

    const saved = await models.add(draft({ baseURL: 'http://localhost:11434/v1', model: 'm' }));
    expect(saved).toMatchObject({ status: 'ok', quarantined: true });
    expect(await readQuarantine(store, MODEL_CONFIGS_KEY)).toEqual([
      expect.objectContaining({ key: MODEL_CONFIGS_KEY, raw: broken }),
    ]);
  });

  it('says when the stored default cannot be read, and uses the first item meanwhile', async () => {
    const { models } = setup({ ...list(openai, deepseek), [SELECTION_KEY]: 'garbage' });
    expect(await models.list()).toMatchObject({ defaultId: 'a', defaultUnreadable: true });
  });
});

describe('model configurations: changes', () => {
  it('adds a configuration with a fresh id, inside a versioned envelope', async () => {
    const { models, store } = setup();

    const view = await models.add(
      draft({ name: '本地', baseURL: 'http://localhost:11434/v1', model: 'qwen2.5:7b' }),
    );

    expect(view).toMatchObject({ items: [ollama], defaultId: 'id-1', status: 'ok' });
    expect(store.dump()[MODEL_CONFIGS_KEY]).toEqual({ version: 1, data: [ollama] });
  });

  it('changes only the fields the patch names, of only that configuration', async () => {
    const { models, store } = setup(list({ ...openai, apiKey: 'keep-me' }, deepseek));

    await models.update('a', { model: 'gpt-4o-mini' });

    expect(store.dump()[MODEL_CONFIGS_KEY]).toEqual({
      version: 1,
      data: [{ ...openai, apiKey: 'keep-me', model: 'gpt-4o-mini' }, deepseek],
    });
  });

  it('keeps fields a newer version added when it saves', async () => {
    const { models, store } = setup(list({ ...openai, future: { x: 1 } }));

    await models.update('a', { name: '改名' });

    expect(store.dump()[MODEL_CONFIGS_KEY]).toEqual({
      version: 1,
      data: [{ ...openai, name: '改名', future: { x: 1 } }],
    });
  });

  it('moves a configuration one step', async () => {
    const { models } = setup(list(openai, deepseek, gateway));

    expect(ids(await models.move('c', 'up'))).toEqual(['a', 'c', 'b']);
    expect(ids(await models.move('a', 'up'))).toEqual(['a', 'c', 'b']);
  });

  it.each([
    ['update', (m: Models) => m.update('x', { name: 'n' })],
    ['remove', (m: Models) => m.remove('x')],
    ['move', (m: Models) => m.move('x', 'down')],
    ['setDefault', (m: Models) => m.setDefault('x')],
  ])('refuses to %s an id that is not in the list, changing nothing', async (_name, act) => {
    const stored = list(openai);
    const { models, store } = setup(stored);

    await expect(act(models)).rejects.toBeInstanceOf(NotFoundError);
    expect(store.dump()).toEqual(stored);
  });

  it('keeps both of two concurrent additions', async () => {
    const { models } = setup();

    await Promise.all([
      models.add(draft({ baseURL: 'https://a.example/v1', model: 'a' })),
      models.add(draft({ baseURL: 'https://b.example/v1', model: 'b' })),
    ]);

    expect((await models.list()).items.map((item) => item.model).sort()).toEqual(['a', 'b']);
  });

  it('loses nothing when the settings page and the panel change it at the same time', async () => {
    const { models } = setup(list(openai, deepseek));

    // The settings page renames one and adds another while the panel picks a default.
    await Promise.all([
      models.update('a', { name: '主力' }),
      models.setDefault('b'),
      models.add(draft({ baseURL: 'https://gw.example/v1', model: 'c' })),
    ]);

    const view = await models.list();
    expect(view.items.map((item) => [item.id, item.name])).toEqual([
      ['a', '主力'],
      ['b', ''],
      ['id-1', ''],
    ]);
    expect(view.defaultId).toBe('b');
  });
});

describe('model configurations: the default', () => {
  it('stores the chosen default', async () => {
    const { models, store } = setup(list(openai, deepseek));

    expect(await models.setDefault('b')).toMatchObject({ defaultId: 'b', defaultFellBack: false });
    expect(store.dump()[SELECTION_KEY]).toEqual({
      version: 1,
      data: { defaultModelId: 'b', defaultPromptId: null },
    });
  });

  it('falls back to the first configuration when the default is removed, and says so', async () => {
    const { models } = setup({
      ...list(openai, deepseek, gateway),
      [SELECTION_KEY]: { version: 1, data: { defaultModelId: 'b', defaultPromptId: null } },
    });

    const view = await models.remove('b');

    expect(view).toMatchObject({ defaultId: 'a', defaultFellBack: true });
    expect(ids(view)).toEqual(['a', 'c']);
  });

  it('says nothing about the default when another configuration is removed', async () => {
    const { models } = setup(list(openai, deepseek));
    expect(await models.remove('b')).toMatchObject({ defaultId: 'a', defaultFellBack: false });
  });

  it('leaves no default once the last configuration is gone', async () => {
    const { models } = setup(list(openai));
    expect(await models.remove('a')).toMatchObject({
      items: [],
      defaultId: null,
      defaultFellBack: true,
    });
  });

  it('keeps an implicit default in place when another configuration moves above it', async () => {
    // No default chosen yet (as after an upgrade from phase 1): the first one is in use.
    const { models, store } = setup(list(openai, deepseek));

    expect(await models.move('b', 'up')).toMatchObject({ defaultId: 'a' });
    expect(store.dump()[SELECTION_KEY]).toMatchObject({ data: { defaultModelId: 'a' } });
  });

  it('backs up an unreadable default when it chooses a new one', async () => {
    const { models, store } = setup({ ...list(openai, deepseek), [SELECTION_KEY]: 'garbage' });

    expect(await models.setDefault('b')).toMatchObject({ defaultId: 'b', quarantined: true });
    expect((await readQuarantine(store, SELECTION_KEY)).map((entry) => entry.raw)).toEqual([
      'garbage',
    ]);
  });

  it('refuses, before writing anything, a change that would move a read-only default', async () => {
    const newer = { version: 2, data: { defaultModelId: null, defaultPromptId: null } };
    const stored = { ...list(openai, deepseek), [SELECTION_KEY]: newer };
    const { models, store } = setup(stored);

    // Moving `b` above the implicit default would need the default stored.
    await expect(models.move('b', 'up')).rejects.toBeInstanceOf(ReadOnlyRecordError);
    expect(store.dump()).toEqual(stored);

    // A change that leaves the default alone still goes through.
    await models.update('b', { name: '备用' });
    expect((await models.list()).items[1]?.name).toBe('备用');
  });
});

describe('model configurations: host access', () => {
  it('gives back the origin of a removed configuration that nothing else uses', async () => {
    const { models, released } = setup(list(openai, deepseek));

    await models.remove('a');

    expect(released).toEqual(['https://api.openai.com/*']);
  });

  it('keeps an origin that another configuration still uses', async () => {
    const second = config('d', 'https://api.openai.com/v1', { model: 'o3' });
    const { models, releaseOrigins } = setup(list(openai, second));

    await models.remove('a');

    expect(releaseOrigins).not.toHaveBeenCalled();
  });

  it('keeps an origin that an unrecognized row still uses', async () => {
    const fromNewerVersion = { baseURL: 'https://api.openai.com/v1', shape: 'v9' };
    const { models, releaseOrigins } = setup(list(openai, fromNewerVersion));

    await models.remove('a');

    expect(releaseOrigins).not.toHaveBeenCalled();
  });

  it('gives back the old origin when a base URL moves elsewhere', async () => {
    const { models, released } = setup(list(openai));

    await models.update('a', { baseURL: 'https://proxy.example/v1' });

    expect(released).toEqual(['https://api.openai.com/*']);
  });

  it('releases only once the change is stored', async () => {
    const { models, store, releaseOrigins } = setup(list(openai, deepseek));
    let storedAtRelease: unknown;
    releaseOrigins.mockImplementation(() => {
      storedAtRelease = store.dump()[MODEL_CONFIGS_KEY];
      return Promise.resolve();
    });

    await models.remove('a');

    expect(storedAtRelease).toEqual({ version: 1, data: [deepseek] });
  });

  it('still reports the change when giving access back fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { models, releaseOrigins } = setup(list(openai, deepseek));
    releaseOrigins.mockRejectedValue(new Error('permissions API unavailable'));

    expect(ids(await models.remove('a'))).toEqual(['b']);
    expect(error).toHaveBeenCalled();
  });
});

type Models = ReturnType<typeof createModelConfigsService>;
