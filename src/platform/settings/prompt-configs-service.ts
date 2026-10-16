import {
  PROMPT_CONFIGS_KEY,
  PROMPT_CONFIGS_VERSION,
  PromptConfig,
  type PromptConfigPatch,
} from '@/contract/prompt-config';
import type { ParsedPromptConfigDraft } from '@/contract/rpc';
import type { Locale } from '@/contract/rpc-wire';
import { builtinPrompts } from '@/domain/prompt/default-prompt';
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
 * Until the list is first written, it holds the built-in prompts (the general
 * summary first, as the default): a fresh install and an upgrade that never
 * stored prompts both start with them, and the first change stores them
 * along with that change. Once the
 * list exists it is the user's: deleting every prompt leaves it empty, and the
 * built-in ones do not come back (docs/development-plan.md §4.3, decision 4).
 * The built-in prompts are in the interface language of the moment (`locale`).
 */
export function createPromptConfigsService(
  store: StorageLike,
  queue: Queue,
  {
    newId = () => crypto.randomUUID(),
    locale = () => 'zh-Hans',
  }: { newId?: () => string; locale?: () => Locale } = {},
): PromptConfigsService {
  return createConfigListService(store, queue, {
    what: 'prompt',
    list: {
      key: PROMPT_CONFIGS_KEY,
      version: PROMPT_CONFIGS_VERSION,
      row: PromptConfig,
      defaults: () => builtinPrompts(locale()),
    },
    selectionField: 'defaultPromptId',
    create: (draft: ParsedPromptConfigDraft, id) => PromptConfig.parse({ ...draft, id }),
    newId,
  });
}
