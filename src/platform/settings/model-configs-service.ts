import {
  MODEL_CONFIGS_KEY,
  MODEL_CONFIGS_VERSION,
  ModelConfig,
  displayName,
  type ModelConfigPatch,
} from '@/contract/model-config';
import type {
  FallbackView,
  ModelConfigsChange,
  ModelConfigsView,
  ParsedModelConfigDraft,
} from '@/contract/rpc';
import type { Fallback } from '@/domain/list-mutations';
import { releasedOrigins } from '@/domain/url';
import type { Queue, StorageLike } from '@/platform/storage';
import { createListService, type ListChange } from './list-service';

export interface ModelConfigsService {
  list(): Promise<ModelConfigsView>;
  add(draft: ParsedModelConfigDraft): Promise<ModelConfigsChange>;
  /** Changes only the fields named in `patch`; fails when `id` is not in the list. */
  update(id: string, patch: ModelConfigPatch): Promise<ModelConfigsChange>;
  remove(id: string): Promise<ModelConfigsChange>;
  move(id: string, to: number): Promise<ModelConfigsChange>;
  setDefault(id: string): Promise<string>;
}

export interface ModelConfigsDeps {
  newId?: () => string;
  /**
   * Gives back host permissions (patterns); resolves to those actually given
   * back. Runs after a change, outside the write queue.
   */
  release?: (patterns: string[]) => Promise<string[]>;
}

/**
 * The model list (docs/development-plan.md §4.3). Removing a configuration,
 * or moving its base URL elsewhere, gives back the origin's host permission
 * once no configuration uses it (decision 5).
 */
export function createModelConfigsService(
  store: StorageLike,
  queue: Queue,
  { newId, release = () => Promise.resolve([]) }: ModelConfigsDeps = {},
): ModelConfigsService {
  const list = createListService<ModelConfig, ParsedModelConfigDraft, ModelConfigPatch>(
    store,
    queue,
    {
      key: MODEL_CONFIGS_KEY,
      version: MODEL_CONFIGS_VERSION,
      row: ModelConfig,
      selectionField: 'defaultModelId',
      noun: 'model configuration',
      create: (draft, id) => ModelConfig.parse({ ...draft, id }),
    },
    newId,
  );

  const finish = async (change: ListChange<ModelConfig>): Promise<ModelConfigsChange> => {
    const unused = releasedOrigins(
      change.before.map((config) => config.baseURL),
      change.view.items.map((config) => config.baseURL),
    );
    const released = unused.length === 0 ? [] : await release(unused);
    return { ...change.view, fallback: fallbackView(change.fallback), released };
  };

  return {
    list: () => list.view(),
    add: async (draft) => finish(await list.add(draft)),
    update: async (id, patch) => finish(await list.update(id, patch)),
    remove: async (id) => finish(await list.remove(id)),
    move: async (id, to) => finish(await list.move(id, to)),
    setDefault: (id) => list.setDefault(id),
  };
}

function fallbackView(fallback: Fallback<ModelConfig> | null): FallbackView | null {
  if (fallback === null) return null;
  const ref = (config: ModelConfig) => ({ id: config.id, name: displayName(config) });
  return { from: ref(fallback.from), to: fallback.to === null ? null : ref(fallback.to) };
}
