import {
  MODEL_CONFIGS_KEY,
  MODEL_CONFIGS_VERSION,
  ModelConfig,
  type ModelConfigPatch,
} from '@/contract/model-config';
import type { ParsedModelConfigDraft } from '@/contract/rpc';
import { originsNoLongerNeeded } from '@/domain/origins';
import type { Queue, StorageLike } from '@/platform/storage';
import { createConfigListService, type ConfigListService } from './config-list-service';

export type ModelConfigsService = ConfigListService<
  ModelConfig,
  ParsedModelConfigDraft,
  ModelConfigPatch
>;

export interface ModelConfigsDeps {
  newId?: () => string;
  /**
   * Gives back host access no configuration needs any more (docs/development-
   * plan.md §4.3, decision 5). Called inside the change's slot of the write
   * queue, so it sees the list as just written.
   */
  releaseOrigins?: (patterns: string[]) => Promise<void>;
}

/** Model configurations (D1): a list with a default, stored in `storage.local`. */
export function createModelConfigsService(
  store: StorageLike,
  queue: Queue,
  { newId = () => crypto.randomUUID(), releaseOrigins }: ModelConfigsDeps = {},
): ModelConfigsService {
  return createConfigListService(store, queue, {
    what: 'model configuration',
    list: {
      key: MODEL_CONFIGS_KEY,
      version: MODEL_CONFIGS_VERSION,
      row: ModelConfig,
      defaults: () => [],
    },
    selectionField: 'defaultModelId',
    create: (draft: ParsedModelConfigDraft, id) => ModelConfig.parse({ ...draft, id }),
    newId,
    // Every row counts, unrecognized ones too: an origin is released only
    // when no stored configuration uses it.
    afterChange: async (before, after) => {
      const released = originsNoLongerNeeded(before, after);
      if (released.length > 0 && releaseOrigins) await releaseOrigins(released);
    },
  });
}
