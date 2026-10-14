import {
  PROMPT_CONFIGS_KEY,
  PROMPT_CONFIGS_VERSION,
  PromptConfig,
  type PromptConfigPatch,
} from '@/contract/prompt-config';
import type { ParsedPromptConfigDraft } from '@/contract/rpc';
import { builtinPrompt } from '@/domain/prompt/default-prompt';
import type { Queue, StorageLike } from '@/platform/storage';
import { createConfigListService, type ConfigListService } from './config-list-service';

export type PromptConfigsService = ConfigListService<
  PromptConfig,
  ParsedPromptConfigDraft,
  PromptConfigPatch
>;

/**
 * Prompts: a list with a default, stored in `storage.local`.
 *
 * Until the list is first written, it holds the built-in prompt: a fresh
 * install and an upgrade from phase 1 (which never stored prompts) both start
 * with it, and the first change stores it along with that change. Once the
 * list exists it is the user's: deleting every prompt leaves it empty, and the
 * built-in one does not come back (docs/development-plan.md §4.3, decision 4).
 */
export function createPromptConfigsService(
  store: StorageLike,
  queue: Queue,
  { newId = () => crypto.randomUUID() }: { newId?: () => string } = {},
): PromptConfigsService {
  return createConfigListService(store, queue, {
    what: 'prompt',
    list: {
      key: PROMPT_CONFIGS_KEY,
      version: PROMPT_CONFIGS_VERSION,
      row: PromptConfig,
      defaults: () => [builtinPrompt()],
    },
    selectionField: 'defaultPromptId',
    create: (draft: ParsedPromptConfigDraft, id) => PromptConfig.parse({ ...draft, id }),
    newId,
  });
}
