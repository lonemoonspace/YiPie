import type {
  ModelConfigsView,
  ParsedModelConfigDraft,
  ParsedPromptConfigDraft,
  PromptConfigsView,
} from '@/contract/rpc';
import type { Queue } from '@/platform/storage';
import type { ModelConfigsService } from './model-configs-service';
import type { PromptConfigsService } from './prompt-configs-service';

export interface ConfigImportInput {
  models: readonly ParsedModelConfigDraft[];
  prompts: readonly ParsedPromptConfigDraft[];
}

/**
 * An import (docs/development-plan.md §4.6, detail 10): both lists, or
 * neither. Both appends run in one slot of the write queue, and a list that
 * refuses changes (a newer version wrote it) is found before either is
 * written, so a refused import leaves nothing behind that trying again would
 * add a second time. A list with nothing to add is left unwritten.
 */
export function createConfigImport(
  queue: Queue,
  models: Pick<ModelConfigsService, 'list' | 'addAllUnqueued' | 'assertAppendableUnqueued'>,
  prompts: Pick<PromptConfigsService, 'list' | 'addAllUnqueued' | 'assertAppendableUnqueued'>,
): (input: ConfigImportInput) => Promise<{ models: ModelConfigsView; prompts: PromptConfigsView }> {
  return (input) =>
    queue(async () => {
      if (input.models.length > 0) await models.assertAppendableUnqueued();
      if (input.prompts.length > 0) await prompts.assertAppendableUnqueued();
      return {
        models:
          input.models.length > 0 ? await models.addAllUnqueued(input.models) : await models.list(),
        prompts:
          input.prompts.length > 0
            ? await prompts.addAllUnqueued(input.prompts)
            : await prompts.list(),
      };
    });
}
