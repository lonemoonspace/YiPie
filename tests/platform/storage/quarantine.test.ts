import { describe, expect, it } from 'vitest';
import {
  QUARANTINE_LIMIT,
  quarantine,
  quarantineKeyFor,
  readQuarantine,
  removeQuarantined,
} from '@/platform/storage/quarantine';
import { createMemoryStore } from '../../helpers/memory-store';

describe('quarantine', () => {
  it('keeps backups in the same storage area as the original key', () => {
    expect(quarantineKeyFor('local:general-settings')).toBe('local:quarantine:general-settings');
    expect(quarantineKeyFor('session:snapshots:12')).toBe('session:quarantine:snapshots:12');
  });

  it(`keeps the newest ${QUARANTINE_LIMIT} backups of a key`, async () => {
    const store = createMemoryStore();
    for (let i = 1; i <= QUARANTINE_LIMIT + 2; i += 1) {
      await quarantine(store, 'local:x', { attempt: i }, new Date(Date.UTC(2026, 0, i)));
    }

    const backups = await readQuarantine(store, 'local:x');
    expect(backups.map((entry) => entry.raw)).toEqual([
      { attempt: 3 },
      { attempt: 4 },
      { attempt: 5 },
    ]);
    expect(backups[0]?.at).toBe('2026-01-03T00:00:00.000Z');
  });

  it('keeps a damaged backup list instead of replacing it', async () => {
    const store = createMemoryStore({ 'local:quarantine:x': 'not a list' });
    await quarantine(store, 'local:x', 'new backup');

    const backups = await readQuarantine(store, 'local:x');
    expect(backups.map((entry) => entry.raw)).toEqual(['not a list', 'new backup']);
  });

  it('turns damaged entries of a backup list into backups of unknown time', async () => {
    const good = { key: 'local:x', at: '2026-01-01T00:00:00.000Z', raw: { a: 1 } };
    const store = createMemoryStore({ 'local:quarantine:x': [good, 42, { at: 'no raw' }] });

    expect(await readQuarantine(store, 'local:x')).toEqual([
      good,
      { key: 'local:x', at: 'unknown', raw: 42 },
      { key: 'local:x', at: 'unknown', raw: { at: 'no raw' } },
    ]);
  });
});

describe('removing a backup', () => {
  const at = (day: number) => new Date(Date.UTC(2026, 0, day));

  it('deletes only the backup taken at the given time', async () => {
    const store = createMemoryStore();
    await quarantine(store, 'local:x', 'first', at(1));
    await quarantine(store, 'local:x', 'second', at(2));

    expect(await removeQuarantined(store, 'local:x', at(1).toISOString())).toBe(true);
    expect((await readQuarantine(store, 'local:x')).map((entry) => entry.raw)).toEqual(['second']);
  });

  it('drops the backup key once its last backup is gone', async () => {
    const store = createMemoryStore();
    await quarantine(store, 'local:x', 'only', at(1));

    await removeQuarantined(store, 'local:x', at(1).toISOString());
    expect(store.dump()).toEqual({});
  });

  it('reports a backup that is not there, changing nothing', async () => {
    const store = createMemoryStore();
    await quarantine(store, 'local:x', 'kept', at(1));
    const before = store.dump();

    expect(await removeQuarantined(store, 'local:x', at(9).toISOString())).toBe(false);
    expect(store.dump()).toEqual(before);
  });
});
