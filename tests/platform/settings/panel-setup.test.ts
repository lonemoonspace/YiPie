import { describe, expect, it } from 'vitest';
import { ModelConfig } from '@/contract/model-config';
import { PromptConfig } from '@/contract/prompt-config';
import type { ModelConfigsView, PromptConfigsView } from '@/contract/rpc';
import { BUILT_IN_PROMPT } from '@/domain/prompt/default-prompt';
import { panelSetup } from '@/platform/settings/panel-setup';

const model = (id: string, apiKey: string) =>
  ModelConfig.parse({ id, baseURL: 'https://api.example/v1', apiKey, model: `m-${id}` });

const view = <T>(items: T[], defaultId: string | null) => ({
  items,
  defaultId,
  status: 'ok' as const,
  readOnly: false,
  quarantined: false,
});

const lists = (models: ModelConfigsView, prompts: PromptConfigsView) => ({
  models: { list: () => Promise.resolve(models) },
  prompts: { list: () => Promise.resolve(prompts) },
});

describe('panelSetup', () => {
  it('names every model but carries the key of the default one only', async () => {
    const terse = PromptConfig.parse({ id: 'p', name: '简短', user: '{{content}}' });
    const { models, prompts } = lists(
      view([model('a', 'sk-a'), model('b', 'sk-b')], 'b'),
      view([terse], 'p'),
    );

    const setup = await panelSetup(models, prompts);

    expect(setup.models).toEqual([
      { id: 'a', name: 'm-a' },
      { id: 'b', name: 'm-b' },
    ]);
    expect(setup.model?.id).toBe('b');
    expect(JSON.stringify(setup)).not.toContain('sk-a');
    expect(setup.prompt).toEqual({ name: '简短', system: '', user: '{{content}}' });
  });

  it('has no model for an empty list, and uses the built-in prompt for an empty prompt list', async () => {
    const { models, prompts } = lists(view([], null), view([], null));

    expect(await panelSetup(models, prompts)).toEqual({
      models: [],
      model: null,
      prompt: {
        name: BUILT_IN_PROMPT.name,
        system: BUILT_IN_PROMPT.system,
        user: BUILT_IN_PROMPT.user,
      },
    });
  });
});
