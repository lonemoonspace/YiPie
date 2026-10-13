import { describe, expect, it } from 'vitest';
import {
  QUARANTINE_LIMIT,
  quarantine,
  quarantineKeyFor,
  readQuarantine,
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
});
