import { BACKED_UP_KEYS, type Backup, type BackupRef, type BackupsView } from '@/contract/backups';
import {
  readQuarantine,
  removeQuarantined,
  type Queue,
  type StorageLike,
} from '@/platform/storage';
import { NotFoundError } from './errors';

export interface BackupsService {
  list(): Promise<BackupsView>;
  /** Deletes one backup; fails when it is no longer the one at that position. */
  remove(ref: BackupRef): Promise<BackupsView>;
}

/**
 * The backups of unreadable values, for the settings page to show, export and
 * delete (docs/development-plan.md §7). Deleting is the only way a backup
 * goes, and only ever on the user's request.
 */
export function createBackupsService(store: StorageLike, queue: Queue): BackupsService {
  async function list(): Promise<BackupsView> {
    const backups: Backup[] = [];
    for (const key of BACKED_UP_KEYS) {
      const entries = await readQuarantine(store, key);
      entries.forEach((entry, index) => backups.push({ key, index, at: entry.at, raw: entry.raw }));
    }
    return { backups };
  }

  return {
    list,
    async remove({ key, index, at }) {
      const removed = await queue(() => removeQuarantined(store, key, index, at));
      if (!removed) throw new NotFoundError('backup', `${key} #${index}`);
      return list();
    },
  };
}
