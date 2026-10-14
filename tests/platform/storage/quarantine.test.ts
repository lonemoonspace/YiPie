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

  it('keeps a damaged entry in a backup list, wrapped instead of dropped', async () => {
    const store = createMemoryStore({
      'local:quarantine:x': [{ key: 'local:x', at: '2026-01-01T00:00:00.000Z', raw: 1 }, 'junk'],
    });

    expect(await readQuarantine(store, 'local:x')).toEqual([
      { key: 'local:x', at: '2026-01-01T00:00:00.000Z', raw: 1 },
      { key: 'local:x', at: 'unknown', raw: 'junk' },
    ]);
  });
});

describe('removeQuarantined', () => {
  const at = (day: number) => new Date(Date.UTC(2026, 0, day));

  it('deletes the one backup asked for, only while it is still the one shown', async () => {
    const store = createMemoryStore();
    await quarantine(store, 'local:x', 'one', at(1));
    await quarantine(store, 'local:x', 'two', at(2));

    expect(await removeQuarantined(store, 'local:x', 0, at(2).toISOString())).toBe(false);
    expect(await removeQuarantined(store, 'local:x', 5, at(1).toISOString())).toBe(false);
    expect((await readQuarantine(store, 'local:x')).map((entry) => entry.raw)).toEqual([
      'one',
      'two',
    ]);

    expect(await removeQuarantined(store, 'local:x', 0, at(1).toISOString())).toBe(true);
    expect((await readQuarantine(store, 'local:x')).map((entry) => entry.raw)).toEqual(['two']);
  });

  it('removes the backup key once its last backup is deleted', async () => {
    const store = createMemoryStore();
    await quarantine(store, 'local:x', 'only', at(1));

    expect(await removeQuarantined(store, 'local:x', 0, at(1).toISOString())).toBe(true);
    expect(store.dump()).toEqual({});
  });
});
