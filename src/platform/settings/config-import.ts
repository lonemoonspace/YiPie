import type {
  ModelConfigsView,
  ParsedModelConfigDraft,
  ParsedPromptConfigDraft,
  PromptConfigsView,
} from '@/contract/rpc';
import { createLogger } from '@/platform/logger';
import type { Queue } from '@/platform/storage';
import type { ModelConfigsService } from './model-configs-service';
import type { PromptConfigsService } from './prompt-configs-service';

const logger = createLogger('settings');

export interface ConfigImportInput {
  models: readonly ParsedModelConfigDraft[];
  prompts: readonly ParsedPromptConfigDraft[];
}

/** What an import uses of each list. */
type ImportMethods = 'list' | 'addAllUnqueued' | 'removeAllUnqueued' | 'assertAppendableUnqueued';

/**
 * The models were appended, the prompts failed, and taking the models out
 * again failed too: an import that tells the user it is half done, rather
 * than one that looks refused and adds the models a second time on retry.
 */
export class ImportHalfDoneError extends Error {
  constructor(prompts: unknown, undo: unknown) {
    super(
      `The models were imported but the prompts were not (${messageOf(prompts)}), and removing the models again failed (${messageOf(undo)}).`,
      { cause: prompts },
    );
    this.name = 'ImportHalfDoneError';
  }
}

/**
 * An import (docs/development-plan.md §4.6, detail 10): both lists, or
 * neither. Both appends run in one slot of the write queue. A list that
 * refuses changes (a newer version wrote it) is found before either is
 * written; when the second write fails anyway (quota, I/O), the models just
 * added are taken out again, so trying again does not add them twice. Should
 * that fail too, the error says so (`ImportHalfDoneError`). A list with
 * nothing to add is left unwritten.
 */
export function createConfigImport(
  queue: Queue,
  models: Pick<ModelConfigsService, ImportMethods>,
  prompts: Pick<PromptConfigsService, ImportMethods>,
): (input: ConfigImportInput) => Promise<{ models: ModelConfigsView; prompts: PromptConfigsView }> {
  return (input) =>
    queue(async () => {
      if (input.models.length > 0) await models.assertAppendableUnqueued();
      if (input.prompts.length > 0) await prompts.assertAppendableUnqueued();

      const modelsView =
        input.models.length > 0 ? await models.addAllUnqueued(input.models) : await models.list();
      if (input.prompts.length === 0) return { models: modelsView, prompts: await prompts.list() };
      try {
        return { models: modelsView, prompts: await prompts.addAllUnqueued(input.prompts) };
      } catch (error) {
        if (input.models.length > 0) {
          // Appended items come last among the recognized ones.
          const added = modelsView.items.slice(-input.models.length).map((item) => item.id);
          try {
            await models.removeAllUnqueued(added);
          } catch (undo) {
            logger.error('Could not take the imported models out again:', undo);
            throw new ImportHalfDoneError(error, undo);
          }
        }
        throw error;
      }
    });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
