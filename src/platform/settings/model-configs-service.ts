import {
  MODEL_CONFIGS_KEY,
  MODEL_CONFIGS_VERSION,
  ModelConfig,
  displayName,
  menuModelNames,
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
import { NotFoundError } from './errors';

export interface ModelConfigsService extends ConfigListService<
  ModelConfig,
  ParsedModelConfigDraft,
  ModelConfigPatch
> {
  /** What the panel may hold: the menu without credentials, and the model in use. */
  current(): Promise<PanelModelsView>;
  /**
   * The panel's menu: makes `id` the default, then answers like `current`.
   * With `model`, one of the names that configuration's menu offers, it
   * becomes the configuration's model name in the same change; the menu's
   * names stay as they were.
   */
  choose(id: string, model?: string): Promise<PanelModelsView>;
  /** `choose` for a task that already runs in the write queue. */
  chooseUnqueued(id: string, model?: string): Promise<PanelModelsView>;
  /**
   * The service of `id` refused `stream_options`: stop asking it for usage
   * (docs/development-plan.md §4.5, decision 2), then answer like `current`.
   */
  disableStreamUsage(id: string): Promise<PanelModelsView>;
  /** `disableStreamUsage` inside a task of the write queue the caller already holds. */
  disableStreamUsageUnqueued(id: string): Promise<PanelModelsView>;
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

  const chooseUnqueued = async (id: string, model?: string) => {
    if (model !== undefined) {
      const config = (await configs.list()).items.find((item) => item.id === id);
      if (config === undefined) throw new NotFoundError('model configuration', id);
      const names = menuModelNames(config);
      if (!names.includes(model)) throw new NotFoundError(`model of ${id} named`, model);
      if (model !== config.model) {
        await configs.updateUnqueued(id, { model, menuModels: names });
      }
    }
    return forPanel(await configs.setDefaultUnqueued(id));
  };

  return {
    ...configs,
    current: async () => forPanel(await configs.list()),
    choose: (id, model) => queue(() => chooseUnqueued(id, model)),
    chooseUnqueued,
    disableStreamUsage: async (id) => forPanel(await configs.update(id, { streamUsage: false })),
    disableStreamUsageUnqueued: async (id) =>
      forPanel(await configs.updateUnqueued(id, { streamUsage: false })),
  };
}

/**
 * Narrows the list to what the panel needs: names for its menu, and the one
 * configuration it calls. Another model's key never reaches the panel.
 */
export function forPanel(view: ListView<ModelConfig>): PanelModelsView {
  const current = view.items.find((config) => config.id === view.defaultId);
  return {
    choices: view.items.map((config) => ({
      id: config.id,
      name: displayName(config),
      model: config.model,
      models: menuModelNames(config),
    })),
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
