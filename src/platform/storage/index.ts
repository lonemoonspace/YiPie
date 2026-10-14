import { createQueue } from './tx';
import type { StorageLike } from './types';
import { createWxtStore } from './wxt-store';

export {
  createIsolationGate,
  ensureLocalStorageIsolated,
  type AccessLevelArea,
} from './access-level';
export {
  createListRepo,
  splitRows,
  type ListDefinition,
  type ListRepo,
  type Rows,
} from './list-repo';
export {
  QUARANTINE_LIMIT,
  readQuarantine,
  removeQuarantined,
  type QuarantineEntry,
} from './quarantine';
export {
  createRepo,
  ReadOnlyRecordError,
  storedVersionOf,
  type InvalidReason,
  type ReadResult,
  type RecordDefinition,
  type Repo,
  type UpdateResult,
} from './repo';
export { createQueue, type Queue } from './tx';
export type { StorageLike } from './types';

let store: StorageLike | undefined;

/** The extension's storage, created on first use. */
export function getExtensionStore(): StorageLike {
  return (store ??= createWxtStore());
}

/**
 * The one write queue. Writes only happen in the service worker, so this
 * instance is the only one that ever serializes anything.
 */
export const writeQueue = createQueue();
