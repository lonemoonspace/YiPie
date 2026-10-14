import {
  MODEL_CONFIGS_KEY,
  MODEL_CONFIGS_VERSION,
  ModelConfig,
  displayName,
  type ModelConfigPatch,
} from '@/contract/model-config';
import type {
  ListView,
  PanelModelConfig,
  PanelModelsView,
  ParsedModelConfigDraft,
} from '@/contract/rpc';
import { originsNoLongerNeeded } from '@/domain/origins';
import type { Queue, StorageLike } from '@/platform/storage';
import { createConfigListService, type ConfigListService } from './config-list-service';

export interface ModelConfigsService extends ConfigListService<
  ModelConfig,
  ParsedModelConfigDraft,
  ModelConfigPatch
> {
  /** What the panel may hold: the menu without credentials, and the model in use. */
  current(): Promise<PanelModelsView>;
  /** The panel's menu: makes `id` the default, then answers like `current`. */
  choose(id: string): Promise<PanelModelsView>;
}

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
  const configs = createConfigListService(store, queue, {
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

  return {
    ...configs,
    current: async () => forPanel(await configs.list()),
    choose: async (id) => forPanel(await configs.setDefault(id)),
  };
}

/**
 * Narrows the list to what the panel needs: names for its menu, and the one
 * configuration it calls. Another model's key never reaches the panel.
 */
export function forPanel(view: ListView<ModelConfig>): PanelModelsView {
  const current = view.items.find((config) => config.id === view.defaultId);
  return {
    choices: view.items.map((config) => ({ id: config.id, name: displayName(config) })),
    current: current === undefined ? null : requestFields(current),
  };
}

/** The known fields, copied one by one: nothing else stored on the row comes along. */
function requestFields(config: ModelConfig): PanelModelConfig {
  return {
    id: config.id,
    name: config.name,
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    model: config.model,
    headers: config.headers,
    extraBody: config.extraBody,
    contextWindow: config.contextWindow,
    streamUsage: config.streamUsage,
  };
}
