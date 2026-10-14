import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { StorageKey } from '@/contract/storage';
import { listRecord } from '@/platform/storage/list';
import { readQuarantine } from '@/platform/storage/quarantine';
import { createRepo } from '@/platform/storage/repo';
import { createQueue } from '@/platform/storage/tx';
import { createMemoryStore } from '../../helpers/memory-store';

const KEY: StorageKey = 'local:things';
const Thing = z.looseObject({ id: z.string().min(1), label: z.string().default('') });

function setup(data?: unknown) {
  const store = createMemoryStore(data === undefined ? {} : { [KEY]: { version: 1, data } });
  return {
    store,
    repo: createRepo(store, createQueue(), { key: KEY, version: 1, ...listRecord(Thing) }),
  };
}

describe('list records', () => {
  it('read a dirty row as unrecognized: the list stays readable and the row stays out', async () => {
    const { repo } = setup([{ id: 'a' }, { foo: 1 }, { id: 'b', label: 'B' }]);

    expect(await repo.read()).toEqual({
      status: 'ok',
      value: {
        items: [
          { id: 'a', label: '' },
          { id: 'b', label: 'B' },
        ],
        unrecognized: [{ foo: 1 }],
      },
    });
  });

  it('write unrecognized rows back unchanged, after the readable ones', async () => {
    const { repo, store } = setup([{ foo: 1 }, { id: 'a' }, 'junk']);

    await repo.update((list) => ({ ...list, items: [...list.items, { id: 'c', label: 'C' }] }));

    expect(store.dump()[KEY]).toEqual({
      version: 1,
      data: [{ id: 'a', label: '' }, { id: 'c', label: 'C' }, { foo: 1 }, 'junk'],
    });
  });

  it('read a list of nothing but dirty rows as an empty list, keeping every row', async () => {
    const { repo, store } = setup([{ foo: 1 }, null]);

    expect(await repo.read()).toEqual({
      status: 'ok',
      value: { items: [], unrecognized: [{ foo: 1 }, null] },
    });
    await repo.update((list) => list);
    expect(store.dump()[KEY]).toEqual({ version: 1, data: [{ foo: 1 }, null] });
  });

  it('still treat a value that is not a list as unreadable, and back it up before replacing it', async () => {
    const { repo, store } = setup({ not: 'a list' });

    expect(await repo.read()).toMatchObject({
      status: 'invalid',
      reason: 'schema-mismatch',
      value: { items: [], unrecognized: [] },
    });
    expect(await repo.update((list) => list)).toMatchObject({ quarantined: true });
    expect((await readQuarantine(store, KEY)).map((entry) => entry.raw)).toEqual([
      { version: 1, data: { not: 'a list' } },
    ]);
    expect(store.dump()[KEY]).toEqual({ version: 1, data: [] });
  });

  it('refuse to store an item that does not match the row schema, and write nothing', async () => {
    const { repo, store } = setup([{ id: 'a' }]);

    await expect(
      repo.update((list) => ({ ...list, items: [...list.items, { id: '', label: 'x' }] })),
    ).rejects.toThrow();
    expect(store.dump()[KEY]).toEqual({ version: 1, data: [{ id: 'a' }] });
  });
});
