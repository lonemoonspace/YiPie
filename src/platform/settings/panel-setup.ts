import { displayName } from '@/contract/model-config';
import type { PanelSetup } from '@/contract/rpc';
import { BUILT_IN_PROMPT } from '@/domain/prompt/default-prompt';
import type { ModelConfigsService } from './model-configs-service';
import type { PromptConfigsService } from './prompt-configs-service';

/**
 * What the panel needs for a run: the models by name, the full configuration
 * of the default model and nothing of the others, and the prompt in effect
 * (the built-in one when the list is empty).
 */
export async function panelSetup(
  models: Pick<ModelConfigsService, 'list'>,
  prompts: Pick<PromptConfigsService, 'list'>,
): Promise<PanelSetup> {
  const [modelList, promptList] = await Promise.all([models.list(), prompts.list()]);
  const model = modelList.items.find((config) => config.id === modelList.defaultId) ?? null;
  const prompt =
    promptList.items.find((candidate) => candidate.id === promptList.defaultId) ?? BUILT_IN_PROMPT;
  return {
    models: modelList.items.map((config) => ({ id: config.id, name: displayName(config) })),
    model,
    prompt: { name: prompt.name, system: prompt.system, user: prompt.user },
  };
}
