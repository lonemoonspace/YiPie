import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { StorageKey } from '@/contract/storage';
import { createListRepo, splitRows, type ListDefinition } from '@/platform/storage/list-repo';
import { readQuarantine } from '@/platform/storage/quarantine';
import { ReadOnlyRecordError } from '@/platform/storage/repo';
import { createQueue } from '@/platform/storage/tx';
import { createMemoryStore } from '../../helpers/memory-store';

const KEY: StorageKey = 'local:things';

const Thing = z.looseObject({
  id: z.string().min(1),
  label: z.string().default(''),
  size: z.number().int().default(1),
});
type Thing = z.infer<typeof Thing>;

const definition: ListDefinition<Thing> = {
  key: KEY,
  version: 1,
  row: Thing,
  defaults: () => [{ id: 'seed', label: 'built in', size: 1 }],
};

function setup(stored?: unknown) {
  const store = createMemoryStore(stored === undefined ? {} : { [KEY]: stored });
  const queue = createQueue();
  return { store, queue, things: createListRepo(store, queue, definition) };
}

const a = { id: 'a', label: 'A', size: 1 };
const b = { id: 'b', label: 'B', size: 2 };

describe('list repo reads', () => {
  it('sets a row it cannot read aside instead of failing the whole list', async () => {
    const { things } = setup({ version: 1, data: [a, { foo: 1 }, b] });

    expect(await things.read()).toEqual({
      status: 'ok',
      value: { items: [a, b], unrecognized: [{ foo: 1 }] },
    });
  });

  it('sets aside a second row with an id it has already seen', async () => {
    const twin = { ...a, label: 'twin' };
    const { things } = setup({ version: 1, data: [a, twin] });

    expect((await things.read()).value).toEqual({ items: [a], unrecognized: [twin] });
  });

  it('shows the defaults while the key is missing, fresh each time', async () => {
    const { things } = setup();
    const first = await things.read();
    const second = await things.read();

    expect(first).toEqual({
      status: 'missing',
      value: { items: [{ id: 'seed', label: 'built in', size: 1 }], unrecognized: [] },
    });
    expect(first.value.items[0]).not.toBe(second.value.items[0]);
  });

  it('flags a value that is not a list at all as invalid, showing the defaults', async () => {
    const { things } = setup({ version: 1, data: { a } });
    const result = await things.read();

    expect(result.status).toBe('invalid');
    expect(result.value.items.map((item) => item.id)).toEqual(['seed']);
  });
});

describe('list repo writes', () => {
  it('writes unrecognized rows back unchanged, after the items', async () => {
    const dirty = { foo: 1 };
    const { things, store } = setup({ version: 1, data: [dirty, a] });

    await things.update((items) => items.map((item) => ({ ...item, label: 'renamed' })));

    expect(store.dump()[KEY]).toEqual({ version: 1, data: [{ ...a, label: 'renamed' }, dirty] });
  });

  it('keeps fields of a row it does not know, and fills the defaults it does', async () => {
    const { things, store } = setup({ version: 1, data: [{ id: 'a', future: [1, 2] }] });

    await things.update((items) => items);

    expect(store.dump()[KEY]).toEqual({
      version: 1,
      data: [{ id: 'a', label: '', size: 1, future: [1, 2] }],
    });
  });

  it('backs up a value that is not a list before replacing it', async () => {
    const broken = { version: 1, data: 'not a list' };
    const { things, store } = setup(broken);

    const result = await things.update((items) => [...items, b]);

    expect(result.quarantined).toBe(true);
    expect(result.value.items.map((item) => item.id)).toEqual(['seed', 'b']);
    expect((await readQuarantine(store, KEY)).map((entry) => entry.raw)).toEqual([broken]);
  });

  it('refuses to write over a newer version, and still shows the rows it can read', async () => {
    const newer = { version: 2, data: [a, { id: 7 }] };
    const { things, store } = setup(newer);

    const read = await things.read();
    expect(read.status === 'invalid' && read.readOnly).toBe(true);
    expect(read.value).toEqual({ items: [a], unrecognized: [{ id: 7 }] });

    await expect(things.update((items) => items)).rejects.toBeInstanceOf(ReadOnlyRecordError);
    expect(store.dump()[KEY]).toEqual(newer);
  });

  it.each([
    ['a row that fails the schema', [{ id: 'a', size: 1.5 }]],
    ['two rows with one id', [a, { ...b, id: 'a' }]],
  ])('refuses %s and leaves storage alone', async (_label, next) => {
    const stored = { version: 1, data: [a] };
    const { things, store } = setup(stored);

    await expect(things.update(() => next as Thing[])).rejects.toThrow();
    expect(store.dump()[KEY]).toEqual(stored);
  });

  it('keeps both of two concurrent changes', async () => {
    const { things } = setup({ version: 1, data: [] });

    await Promise.all([
      things.update((items) => [...items, a]),
      things.update((items) => [...items, b]),
    ]);

    expect((await things.read()).value.items.map((item) => item.id).sort()).toEqual(['a', 'b']);
  });

  it('lets one queued task change it unqueued, ahead of writes queued meanwhile', async () => {
    const { things, queue } = setup({ version: 1, data: [] });

    const together = queue(async () => {
      await things.updateUnqueued((items) => [...items, a]);
      await things.updateUnqueued((items) => items.map((item) => ({ ...item, size: 9 })));
    });
    const later = things.update((items) => [...items, b]);
    await Promise.all([together, later]);

    // `b` arrived after the task finished, so the second step never saw it.
    expect((await things.read()).value.items).toEqual([{ ...a, size: 9 }, b]);
  });
});

describe('splitRows', () => {
  it('keeps the stored order of each kind of row', () => {
    const rows = [b, 'text', a, null, { id: 'b' }];
    expect(splitRows(rows, Thing)).toEqual({
      items: [b, a],
      unrecognized: ['text', null, { id: 'b' }],
    });
  });
});
