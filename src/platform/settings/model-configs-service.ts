import {
  MODEL_CONFIGS_KEY,
  MODEL_CONFIGS_VERSION,
  ModelConfig,
  ModelConfigList,
  type ModelConfigPatch,
} from '@/contract/model-config';
import type { ModelConfigsView, ParsedModelConfigDraft } from '@/contract/rpc';
import { applyPatch } from '@/domain/patch';
import { createLogger } from '@/platform/logger';
import { createRepo, type Queue, type ReadResult, type StorageLike } from '@/platform/storage';
import { NotFoundError } from './errors';

const logger = createLogger('models');

export interface ModelConfigsService {
  list(): Promise<ModelConfigsView>;
  /** Appends a configuration with a fresh id; runs in the shared write queue. */
  add(draft: ParsedModelConfigDraft): Promise<ModelConfigsView>;
  /** Changes only the fields named in `patch`; fails when `id` is not in the list. */
  update(id: string, patch: ModelConfigPatch): Promise<ModelConfigsView>;
}

export function createModelConfigsService(
  store: StorageLike,
  queue: Queue,
  newId: () => string = () => crypto.randomUUID(),
): ModelConfigsService {
  const repo = createRepo(store, queue, {
    key: MODEL_CONFIGS_KEY,
    version: MODEL_CONFIGS_VERSION,
    schema: ModelConfigList,
    defaults: () => [],
  });

  return {
    async list() {
      return toView(await repo.read());
    },

    async add(draft) {
      const { value, quarantined } = await repo.update((configs) => [
        ...configs,
        ModelConfig.parse({ ...draft, id: newId() }),
      ]);
      return { configs: value, status: 'ok', readOnly: false, quarantined };
    },

    async update(id, patch) {
      const { value, quarantined } = await repo.update((configs) => {
        const index = configs.findIndex((config) => config.id === id);
        if (index === -1) throw new NotFoundError('model configuration', id);
        return configs.map((config, i) => (i === index ? applyPatch(config, patch) : config));
      });
      return { configs: value, status: 'ok', readOnly: false, quarantined };
    },
  };
}

function toView(result: ReadResult<ModelConfigList>): ModelConfigsView {
  if (result.status === 'invalid') {
    logger.warn('Model configurations are unreadable:', result.reason, result.issues);
  }
  return {
    configs: result.value,
    status: result.status,
    readOnly: result.status === 'invalid' && result.readOnly,
    quarantined: false,
  };
}
