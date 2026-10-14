import { describe, expect, it } from 'vitest';
import { MODEL_CONFIGS_KEY, ModelConfigDraft } from '@/contract/model-config';
import { NotFoundError } from '@/platform/settings/errors';
import { createModelConfigsService } from '@/platform/settings/model-configs-service';
import { createQueue, readQuarantine } from '@/platform/storage';
import { createMemoryStore } from '../../helpers/memory-store';

function setup(stored?: unknown) {
  const store = createMemoryStore(stored === undefined ? {} : { [MODEL_CONFIGS_KEY]: stored });
  let next = 0;
  const models = createModelConfigsService(store, createQueue(), () => `id-${++next}`);
  return { store, models };
}

const draft = (fields: Record<string, unknown>) => ModelConfigDraft.parse(fields);

const ollama = {
  id: 'id-1',
  name: '本地',
  baseURL: 'http://localhost:11434/v1',
  apiKey: '',
  model: 'qwen2.5:7b',
  headers: {},
  extraBody: {},
  contextWindow: null,
  streamUsage: true,
};

describe('model configurations service', () => {
  it('starts with an empty list', async () => {
    const { models } = setup();
    expect(await models.list()).toEqual({
      configs: [],
      status: 'missing',
      readOnly: false,
      quarantined: false,
    });
  });

  it('adds a configuration with a fresh id, inside a versioned envelope', async () => {
    const { models, store } = setup();

    const view = await models.add(
      draft({ name: '本地', baseURL: 'http://localhost:11434/v1', model: 'qwen2.5:7b' }),
    );

    expect(view.configs).toEqual([ollama]);
    expect(store.dump()[MODEL_CONFIGS_KEY]).toEqual({ version: 1, data: [ollama] });
  });

  it('updates only the fields named in the patch', async () => {
    const { models, store } = setup({ version: 1, data: [{ ...ollama, apiKey: 'keep-me' }] });

    await models.update('id-1', { model: 'llama3.1:8b' });

    expect(store.dump()[MODEL_CONFIGS_KEY]).toEqual({
      version: 1,
      data: [{ ...ollama, apiKey: 'keep-me', model: 'llama3.1:8b' }],
    });
  });

  it('refuses to update an id that is not in the list', async () => {
    const { models } = setup({ version: 1, data: [ollama] });
    await expect(models.update('nope', { model: 'x' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('keeps both of two concurrent additions', async () => {
    const { models } = setup();

    await Promise.all([
      models.add(draft({ baseURL: 'https://a.example/v1', model: 'a' })),
      models.add(draft({ baseURL: 'https://b.example/v1', model: 'b' })),
    ]);

    expect((await models.list()).configs.map((config) => config.model).sort()).toEqual(['a', 'b']);
  });

  it('keeps fields a newer version added when it saves', async () => {
    const { models, store } = setup({ version: 1, data: [{ ...ollama, future: { x: 1 } }] });

    await models.update('id-1', { name: '改名' });

    expect(store.dump()[MODEL_CONFIGS_KEY]).toEqual({
      version: 1,
      data: [{ ...ollama, name: '改名', future: { x: 1 } }],
    });
  });

  it('backs up an unreadable list before the next save replaces it', async () => {
    const broken = { version: 1, data: [{ id: 'x', baseURL: 'not a url', model: 'm' }] };
    const { models, store } = setup(broken);

    const read = await models.list();
    expect(read).toMatchObject({ status: 'invalid', configs: [] });

    const saved = await models.add(draft({ baseURL: 'http://localhost:11434/v1', model: 'm' }));
    expect(saved.quarantined).toBe(true);
    expect(await readQuarantine(store, MODEL_CONFIGS_KEY)).toEqual([
      expect.objectContaining({ key: MODEL_CONFIGS_KEY, raw: broken }),
    ]);
  });
});
