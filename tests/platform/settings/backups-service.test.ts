import { describe, expect, it } from 'vitest';
import { GENERAL_SETTINGS_KEY } from '@/contract/general-settings';
import { MODEL_CONFIGS_KEY } from '@/contract/model-config';
import { NotFoundError } from '@/platform/settings/errors';
import { createBackupsService } from '@/platform/settings/backups-service';
import { createQueue, readQuarantine } from '@/platform/storage';
import { quarantine } from '@/platform/storage/quarantine';
import { createMemoryStore } from '../../helpers/memory-store';

const at = (day: number) => new Date(Date.UTC(2026, 9, day));

async function setup() {
  const store = createMemoryStore();
  await quarantine(store, MODEL_CONFIGS_KEY, { version: 1, data: 'broken' }, at(1));
  await quarantine(store, MODEL_CONFIGS_KEY, { version: 1, data: 'again' }, at(2));
  await quarantine(store, GENERAL_SETTINGS_KEY, { theme: 42 }, at(3));
  // The extension's own bookkeeping, not the user's: not listed.
  await quarantine(store, 'session:panel-registry', 'registry', at(4));
  const queue = createQueue();
  return { store, queue, backups: createBackupsService(store, queue) };
}

describe('backups service', () => {
  it("lists every backup of the user's records, with the record it came from", async () => {
    const { backups } = await setup();

    expect(await backups.list()).toEqual({
      backups: [
        { key: MODEL_CONFIGS_KEY, at: at(1).toISOString(), raw: { version: 1, data: 'broken' } },
        { key: MODEL_CONFIGS_KEY, at: at(2).toISOString(), raw: { version: 1, data: 'again' } },
        { key: GENERAL_SETTINGS_KEY, at: at(3).toISOString(), raw: { theme: 42 } },
      ],
    });
  });

  it('deletes only the named backup, and answers with the rest', async () => {
    const { backups, store } = await setup();

    const view = await backups.remove(MODEL_CONFIGS_KEY, at(1).toISOString());

    expect(view.backups.map((backup) => backup.at)).toEqual([
      at(2).toISOString(),
      at(3).toISOString(),
    ]);
    expect((await readQuarantine(store, MODEL_CONFIGS_KEY)).map((entry) => entry.raw)).toEqual([
      { version: 1, data: 'again' },
    ]);
  });

  it('refuses a backup that is not there', async () => {
    const { backups } = await setup();
    await expect(backups.remove(GENERAL_SETTINGS_KEY, at(9).toISOString())).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('keeps a backup taken while another one is being deleted', async () => {
    const { backups, store, queue } = await setup();

    await Promise.all([
      backups.remove(MODEL_CONFIGS_KEY, at(1).toISOString()),
      queue(() => quarantine(store, MODEL_CONFIGS_KEY, 'taken meanwhile', at(5))),
    ]);

    expect((await readQuarantine(store, MODEL_CONFIGS_KEY)).map((entry) => entry.raw)).toEqual([
      { version: 1, data: 'again' },
      'taken meanwhile',
    ]);
  });
});
