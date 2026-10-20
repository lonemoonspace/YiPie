import { describe, expect, it } from 'vitest';
import type { StorageKey } from '@/contract/storage';
import { MODEL_CONFIGS_KEY, ModelConfigDraft } from '@/contract/model-config';
import { PROMPT_CONFIGS_KEY, PromptConfigDraft } from '@/contract/prompt-config';
import { ImportHalfDoneError, createConfigImport } from '@/platform/settings/config-import';
import { createModelConfigsService } from '@/platform/settings/model-configs-service';
import { createPromptConfigsService } from '@/platform/settings/prompt-configs-service';
import { ReadOnlyRecordError, createQueue } from '@/platform/storage';
import { createMemoryStore } from '../../helpers/memory-store';

/** A memory store whose writes throw, as a full quota would, wherever `fails` says. */
function setup(
  stored: Record<string, unknown> = {},
  fails: (key: StorageKey) => boolean = () => false,
) {
  const memory = createMemoryStore(stored);
  const store = {
    ...memory,
    async set(key: StorageKey, value: unknown) {
      if (fails(key)) throw new Error(`Quota exceeded writing ${key}`);
      await memory.set(key, value);
    },
  };
  const queue = createQueue();
  let next = 0;
  const newId = () => `id-${++next}`;
  const models = createModelConfigsService(store, queue, { newId });
  const prompts = createPromptConfigsService(store, queue, { newId });
  return { store, models, prompts, importConfig: createConfigImport(queue, models, prompts) };
}

const model = ModelConfigDraft.parse({ baseURL: 'https://api.example/v1', model: 'm' });
const prompt = PromptConfigDraft.parse({ name: '一句话', user: '一句话总结：{{content}}' });

describe('config import', () => {
  it('appends to both lists', async () => {
    const { importConfig, store } = setup();

    const view = await importConfig({ models: [model], prompts: [prompt] });

    expect(view.models.items.map((item) => item.model)).toEqual(['m']);
    expect(view.prompts.items.at(-1)).toMatchObject({ name: '一句话' });
    expect(store.dump()[MODEL_CONFIGS_KEY]).toBeDefined();
    expect(store.dump()[PROMPT_CONFIGS_KEY]).toBeDefined();
  });

  it('writes nothing when one list refuses, so trying again adds nothing twice', async () => {
    const newer = { version: 2, data: [{ id: 'later', shape: 'unknown' }] };
    const { importConfig, models, store } = setup({ [PROMPT_CONFIGS_KEY]: newer });

    await expect(importConfig({ models: [model], prompts: [prompt] })).rejects.toBeInstanceOf(
      ReadOnlyRecordError,
    );
    await expect(importConfig({ models: [model], prompts: [prompt] })).rejects.toBeInstanceOf(
      ReadOnlyRecordError,
    );

    expect((await models.list()).items).toEqual([]);
    expect(store.dump()[MODEL_CONFIGS_KEY]).toBeUndefined();
    expect(store.dump()[PROMPT_CONFIGS_KEY]).toEqual(newer);
  });

  it('leaves a list with nothing to add unwritten, even one that would refuse', async () => {
    const newer = { version: 2, data: [] };
    const { importConfig, store } = setup({ [PROMPT_CONFIGS_KEY]: newer });

    const view = await importConfig({ models: [model], prompts: [] });

    expect(view.models.items).toHaveLength(1);
    expect(view.prompts.readOnly).toBe(true);
    expect(store.dump()[PROMPT_CONFIGS_KEY]).toEqual(newer);
  });

  it('takes the models out again when the prompts fail to write', async () => {
    let full = true;
    const { importConfig, models, store } = setup({}, (key) => full && key === PROMPT_CONFIGS_KEY);

    await expect(importConfig({ models: [model], prompts: [prompt] })).rejects.toThrow(
      'Quota exceeded',
    );
    expect((await models.list()).items).toEqual([]);
    expect(store.dump()[PROMPT_CONFIGS_KEY]).toBeUndefined();

    // Once the prompts can be written, trying again imports each model once.
    full = false;
    const view = await importConfig({ models: [model], prompts: [prompt] });
    expect(view.models.items).toHaveLength(1);
  });

  it('keeps the models already there when it takes the imported ones out', async () => {
    const { importConfig, models } = setup({}, (key) => key === PROMPT_CONFIGS_KEY);
    await models.add(ModelConfigDraft.parse({ baseURL: 'https://kept.example/v1', model: 'k' }));

    await expect(importConfig({ models: [model, model], prompts: [prompt] })).rejects.toThrow();

    expect((await models.list()).items.map((item) => item.model)).toEqual(['k']);
  });

  it('says so when the models cannot be taken out again either', async () => {
    let modelWrites = 0;
    const { importConfig, models } = setup(
      {},
      // The import's own write of the models goes through; nothing after it does.
      (key) => key === PROMPT_CONFIGS_KEY || (key === MODEL_CONFIGS_KEY && ++modelWrites > 1),
    );

    await expect(importConfig({ models: [model], prompts: [prompt] })).rejects.toBeInstanceOf(
      ImportHalfDoneError,
    );
    expect((await models.list()).items.map((item) => item.model)).toEqual(['m']);
  });
});
