import { BACKED_UP_KEYS, type BackedUpKey, type BackupsView } from '@/contract/backups';
import {
  readQuarantine,
  removeQuarantined,
  type Queue,
  type StorageLike,
} from '@/platform/storage';
import { NotFoundError } from './errors';

export interface BackupsService {
  /** Every backup of the user's records, newest last within each record. */
  list(): Promise<BackupsView>;
  /** Deletes the backup of `key` taken at `at`; `NotFoundError` when there is none. */
  remove(key: BackedUpKey, at: string): Promise<BackupsView>;
}

/**
 * The backups the storage layer takes before it overwrites a value it could
 * not read (docs/development-plan.md §7). They stay until the user deletes
 * them here; nothing else removes one, except the per-key limit.
 */
export function createBackupsService(store: StorageLike, queue: Queue): BackupsService {
  const readAll = async (): Promise<BackupsView> => {
    const lists = await Promise.all(
      BACKED_UP_KEYS.map(async (key) =>
        (await readQuarantine(store, key)).map(({ at, raw }) => ({ key, at, raw })),
      ),
    );
    return { backups: lists.flat() };
  };

  return {
    list: readAll,
    remove(key, at) {
      return queue(async () => {
        if (!(await removeQuarantined(store, key, at))) {
          throw new NotFoundError('backup', `${key} at ${at}`);
        }
        return readAll();
      });
    },
  };
}
