import { describe, expect, it } from 'vitest';
import { PROMPT_CONFIGS_KEY, PromptConfigDraft } from '@/contract/prompt-config';
import { SELECTION_KEY } from '@/contract/selection';
import { BUILT_IN_PROMPT } from '@/domain/prompt/default-prompt';
import { createPromptConfigsService } from '@/platform/settings/prompt-configs-service';
import { createQueue } from '@/platform/storage';
import { createMemoryStore } from '../../helpers/memory-store';

function setup(stored: Record<string, unknown> = {}) {
  const store = createMemoryStore(stored);
  let next = 0;
  return { store, prompts: createPromptConfigsService(store, createQueue(), () => `p-${++next}`) };
}

const builtIn = { id: 'p-1', ...BUILT_IN_PROMPT };

describe('prompt configurations service', () => {
  it('seeds the built-in prompt into a list that was never written, and makes it the default', async () => {
    const { prompts, store } = setup();

    expect(await prompts.seedIfMissing()).toBe(true);

    expect(store.dump()).toEqual({
      [PROMPT_CONFIGS_KEY]: { version: 1, data: [builtIn] },
      [SELECTION_KEY]: { version: 1, data: { defaultModelId: null, defaultPromptId: 'p-1' } },
    });
  });

  it('seeds once: a second call, and a list the user emptied, are left alone', async () => {
    const { prompts, store } = setup();
    await prompts.seedIfMissing();
    expect(await prompts.seedIfMissing()).toBe(false);

    await prompts.remove('p-1');
    expect(await prompts.seedIfMissing()).toBe(false);
    expect(store.dump()[PROMPT_CONFIGS_KEY]).toEqual({ version: 1, data: [] });
  });

  it('adds, edits and removes prompts, falling back to the first as the default', async () => {
    const { prompts } = setup();
    await prompts.seedIfMissing();

    const added = await prompts.add(
      PromptConfigDraft.parse({ name: '要点', user: '列出要点：{{content}}' }),
    );
    expect(added.items.map((prompt) => prompt.name)).toEqual(['网页总结', '要点']);

    await prompts.setDefault('p-2');
    await prompts.update('p-2', { system: '简洁。' });
    const removed = await prompts.remove('p-2');

    expect(removed).toMatchObject({
      items: [builtIn],
      defaultId: 'p-1',
      fallback: { from: { id: 'p-2', name: '要点' }, to: { id: 'p-1', name: '网页总结' } },
    });
  });
});
