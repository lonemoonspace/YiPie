import { describe, expect, it } from 'vitest';
import { MODEL_CONFIGS_KEY } from '@/contract/model-config';
import { PROMPT_CONFIGS_KEY, PromptConfigDraft } from '@/contract/prompt-config';
import { SELECTION_KEY } from '@/contract/selection';
import { BUILTIN_PROMPT_ID, builtinPrompt } from '@/domain/prompt/default-prompt';
import { createModelConfigsService } from '@/platform/settings/model-configs-service';
import { createPromptConfigsService } from '@/platform/settings/prompt-configs-service';
import { ReadOnlyRecordError, createQueue, readQuarantine } from '@/platform/storage';
import { createMemoryStore } from '../../helpers/memory-store';

function setup(stored: Record<string, unknown> = {}) {
  const store = createMemoryStore(stored);
  const queue = createQueue();
  let next = 0;
  const prompts = createPromptConfigsService(store, queue, { newId: () => `p-${++next}` });
  return { store, queue, prompts };
}

const draft = (fields: Record<string, unknown>) => PromptConfigDraft.parse(fields);
const terse = { id: 'terse', name: '一句话', system: '', user: '一句话总结：{{content}}' };

describe('prompts: the built-in prompt', () => {
  it('is the list, and the default, until the list is first written', async () => {
    const { prompts, store } = setup();

    expect(await prompts.list()).toMatchObject({
      items: [builtinPrompt('zh-Hans')],
      defaultId: BUILTIN_PROMPT_ID,
      status: 'missing',
    });
    expect(store.dump()).toEqual({});
  });

  it('is stored along with the first change', async () => {
    const { prompts, store } = setup();

    await prompts.add(draft({ name: '一句话', user: '一句话总结：{{content}}' }));

    expect(store.dump()[PROMPT_CONFIGS_KEY]).toEqual({
      version: 1,
      data: [
        builtinPrompt('zh-Hans'),
        { id: 'p-1', name: '一句话', system: '', user: '一句话总结：{{content}}' },
      ],
    });
  });

  it('is in the interface language of the moment until stored, and stays as stored after', async () => {
    const store = createMemoryStore();
    let locale: 'zh-Hans' | 'en' = 'en';
    const prompts = createPromptConfigsService(store, createQueue(), {
      newId: () => 'p-1',
      locale: () => locale,
    });

    expect((await prompts.list()).items).toEqual([builtinPrompt('en')]);
    await prompts.add(draft({ name: 'Terse', user: '{{content}}' }));

    locale = 'zh-Hans';
    expect((await prompts.list()).items[0]).toEqual(builtinPrompt('en'));
  });

  it('can be edited like any other prompt', async () => {
    const { prompts } = setup();

    const view = await prompts.update(BUILTIN_PROMPT_ID, { user: '{{content}}' });

    expect(view.items).toEqual([{ ...builtinPrompt('zh-Hans'), user: '{{content}}' }]);
  });

  it('does not come back once the user has removed every prompt', async () => {
    const { prompts, store } = setup();

    expect(await prompts.remove(BUILTIN_PROMPT_ID)).toMatchObject({
      items: [],
      defaultId: null,
      defaultFellBack: true,
    });
    expect(await prompts.list()).toMatchObject({ items: [], defaultId: null, status: 'ok' });
    expect(store.dump()[PROMPT_CONFIGS_KEY]).toEqual({ version: 1, data: [] });
  });

  it('stands in while the stored list is unreadable, which is backed up before the next save', async () => {
    const broken = { version: 1, data: 'not a list' };
    const { prompts, store } = setup({ [PROMPT_CONFIGS_KEY]: broken });

    expect(await prompts.list()).toMatchObject({
      status: 'invalid',
      items: [builtinPrompt('zh-Hans')],
      defaultId: BUILTIN_PROMPT_ID,
    });

    expect(await prompts.add(draft({ name: 'n', user: '{{content}}' }))).toMatchObject({
      quarantined: true,
    });
    expect((await readQuarantine(store, PROMPT_CONFIGS_KEY)).map((entry) => entry.raw)).toEqual([
      broken,
    ]);
  });
});

describe('prompts: the list', () => {
  it('keeps a row it cannot read, after the prompts it can', async () => {
    const dirty = { foo: 1 };
    const { prompts, store } = setup({
      [PROMPT_CONFIGS_KEY]: { version: 1, data: [dirty, terse] },
    });

    expect(await prompts.list()).toMatchObject({ items: [terse], unrecognized: 1 });
    await prompts.update('terse', { name: '更短' });

    expect(store.dump()[PROMPT_CONFIGS_KEY]).toEqual({
      version: 1,
      data: [{ ...terse, name: '更短' }, dirty],
    });
  });

  it('changes only the named fields', async () => {
    const { prompts, store } = setup({
      [PROMPT_CONFIGS_KEY]: { version: 1, data: [builtinPrompt('zh-Hans'), terse] },
    });

    await prompts.update('terse', { system: '你很简洁。' });

    expect(store.dump()[PROMPT_CONFIGS_KEY]).toEqual({
      version: 1,
      data: [builtinPrompt('zh-Hans'), { ...terse, system: '你很简洁。' }],
    });
  });

  it('stores its default next to the model default, without touching it', async () => {
    const { prompts, store } = setup({
      [PROMPT_CONFIGS_KEY]: { version: 1, data: [builtinPrompt('zh-Hans'), terse] },
      [SELECTION_KEY]: { version: 1, data: { defaultModelId: 'm', defaultPromptId: null } },
    });

    expect(await prompts.setDefault('terse')).toMatchObject({ defaultId: 'terse' });
    expect(store.dump()[SELECTION_KEY]).toEqual({
      version: 1,
      data: { defaultModelId: 'm', defaultPromptId: 'terse' },
    });
  });
});

describe('prompts written by a newer version', () => {
  it('are shown but cannot get a new default, and storage stays as it was', async () => {
    const stored = {
      [PROMPT_CONFIGS_KEY]: { version: 2, data: [builtinPrompt('zh-Hans'), terse] },
    };
    const { prompts, store } = setup(stored);

    expect(await prompts.list()).toMatchObject({
      readOnly: true,
      items: [builtinPrompt('zh-Hans'), terse],
    });
    await expect(prompts.setDefault('terse')).rejects.toBeInstanceOf(ReadOnlyRecordError);
    expect(store.dump()).toEqual(stored);
  });
});

describe('models and prompts share the default record', () => {
  it('loses neither default when both are chosen at the same time', async () => {
    const { store, queue, prompts } = setup({
      [PROMPT_CONFIGS_KEY]: { version: 1, data: [builtinPrompt('zh-Hans'), terse] },
      [MODEL_CONFIGS_KEY]: {
        version: 1,
        data: [
          { id: 'a', baseURL: 'https://a.example/v1', model: 'a' },
          { id: 'b', baseURL: 'https://b.example/v1', model: 'b' },
        ],
      },
    });
    const models = createModelConfigsService(store, queue);

    await Promise.all([models.setDefault('b'), prompts.setDefault('terse')]);

    expect(store.dump()[SELECTION_KEY]).toEqual({
      version: 1,
      data: { defaultModelId: 'b', defaultPromptId: 'terse' },
    });
  });
});

describe('prompts: importing', () => {
  it('appends after the built-in prompt, which stays the default', async () => {
    const { prompts } = setup();

    const view = await prompts.addAll([
      draft({ name: '一句话', user: '{{content}}' }),
      draft({ name: '要点', user: '列出要点：{{content}}' }),
    ]);

    expect(view.items.map((item) => item.id)).toEqual([BUILTIN_PROMPT_ID, 'p-1', 'p-2']);
    expect(view.defaultId).toBe(BUILTIN_PROMPT_ID);
  });
});
