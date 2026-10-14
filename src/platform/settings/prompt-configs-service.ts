import {
  PROMPT_CONFIGS_KEY,
  PROMPT_CONFIGS_VERSION,
  PromptConfig,
  type PromptConfigPatch,
} from '@/contract/prompt-config';
import type {
  ParsedPromptConfigDraft,
  PromptConfigsChange,
  PromptConfigsView,
} from '@/contract/rpc';
import { BUILT_IN_PROMPT } from '@/domain/prompt/default-prompt';
import type { Queue, StorageLike } from '@/platform/storage';
import { createListService, type ListChange } from './list-service';

export interface PromptConfigsService {
  list(): Promise<PromptConfigsView>;
  add(draft: ParsedPromptConfigDraft): Promise<PromptConfigsChange>;
  update(id: string, patch: PromptConfigPatch): Promise<PromptConfigsChange>;
  remove(id: string): Promise<PromptConfigsChange>;
  move(id: string, to: number): Promise<PromptConfigsChange>;
  setDefault(id: string): Promise<string>;
  /**
   * Puts the built-in prompt in the list when the list was never written,
   * so it can be seen and edited. A list the user emptied stays empty: the
   * panel then uses the built-in prompt without storing it.
   */
  seedIfMissing(): Promise<boolean>;
}

export function createPromptConfigsService(
  store: StorageLike,
  queue: Queue,
  newId: () => string = () => crypto.randomUUID(),
): PromptConfigsService {
  const list = createListService<PromptConfig, ParsedPromptConfigDraft, PromptConfigPatch>(
    store,
    queue,
    {
      key: PROMPT_CONFIGS_KEY,
      version: PROMPT_CONFIGS_VERSION,
      row: PromptConfig,
      selectionField: 'defaultPromptId',
      noun: 'prompt',
      create: (draft, id) => PromptConfig.parse({ ...draft, id }),
    },
    newId,
  );

  const finish = (change: ListChange<PromptConfig>): PromptConfigsChange => {
    const { fallback } = change;
    const ref = (prompt: PromptConfig) => ({ id: prompt.id, name: prompt.name });
    return {
      ...change.view,
      fallback:
        fallback === null
          ? null
          : { from: ref(fallback.from), to: fallback.to === null ? null : ref(fallback.to) },
    };
  };

  return {
    list: () => list.view(),
    add: async (draft) => finish(await list.add(draft)),
    update: async (id, patch) => finish(await list.update(id, patch)),
    remove: async (id) => finish(await list.remove(id)),
    move: async (id, to) => finish(await list.move(id, to)),
    setDefault: (id) => list.setDefault(id),
    seedIfMissing: () => list.seed(() => [PromptConfig.parse({ ...BUILT_IN_PROMPT, id: newId() })]),
  };
}
