import { createQueue } from './tx';
import type { StorageLike } from './types';
import { createWxtStore } from './wxt-store';

export { restrictLocalStorageToExtensionPages } from './access-level';
export { QUARANTINE_LIMIT, readQuarantine, type QuarantineEntry } from './quarantine';
export {
  createRepo,
  ReadOnlyRecordError,
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
