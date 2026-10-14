import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { StorageKey } from '@/contract/storage';
import { readQuarantine } from '@/platform/storage/quarantine';
import { createRepo, ReadOnlyRecordError, type RecordDefinition } from '@/platform/storage/repo';
import { createQueue } from '@/platform/storage/tx';
import { createMemoryStore } from '../../helpers/memory-store';

const KEY: StorageKey = 'local:sample';

const Sample = z.looseObject({
  count: z.number().int().default(0),
  label: z.string().default('none'),
});
type Sample = z.infer<typeof Sample>;

const definition: RecordDefinition<Sample> = {
  key: KEY,
  version: 2,
  schema: Sample,
  defaults: () => ({ count: 0, label: 'none' }),
  // Version 1 stored the count under `total`.
  upgrade: (data) => {
    const { total, ...rest } = data as { total?: number };
    return { ...rest, count: total ?? 0 };
  },
};

function setup(initial?: unknown) {
  const store = createMemoryStore(initial === undefined ? {} : { [KEY]: initial });
  return { store, repo: createRepo(store, createQueue(), definition) };
}

describe('repo reads', () => {
  it('reports a missing key as missing, with fresh defaults', async () => {
    const { repo } = setup();
    const first = await repo.read();
    const second = await repo.read();

    expect(first).toEqual({ status: 'missing', value: { count: 0, label: 'none' } });
    expect(first.value).not.toBe(second.value);
  });

  it('reads back what it wrote', async () => {
    const { repo, store } = setup();
    await repo.update(() => ({ count: 3, label: 'three' }));

    expect(store.dump()[KEY]).toEqual({ version: 2, data: { count: 3, label: 'three' } });
    expect(await repo.read()).toEqual({ status: 'ok', value: { count: 3, label: 'three' } });
  });

  it('flags a value that is not an envelope as invalid instead of missing', async () => {
    const { repo } = setup('just a string');
    const result = await repo.read();

    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') return;
    expect(result.reason).toBe('malformed-envelope');
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.raw).toBe('just a string');
    expect(result.value).toEqual({ count: 0, label: 'none' });
  });

  it('flags data that fails the schema, naming the field', async () => {
    const { repo } = setup({ version: 2, data: { count: 'many' } });
    const result = await repo.read();

    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') return;
    expect(result.reason).toBe('schema-mismatch');
    expect(result.issues.join(' ')).toContain('count');
  });

  it('fills defaults for fields added later and keeps fields it does not know', async () => {
    const { repo } = setup({ version: 2, data: { count: 5, futureField: true } });

    expect(await repo.read()).toEqual({
      status: 'ok',
      value: { count: 5, label: 'none', futureField: true },
    });
  });

  it('upgrades older versions on read, and the upgrade is idempotent once written back', async () => {
    const { repo, store } = setup({ version: 1, data: { total: 7, label: 'old' } });

    const upgraded = await repo.read();
    expect(upgraded).toEqual({ status: 'ok', value: { count: 7, label: 'old' } });
    // Nothing is written until the next update.
    expect(store.dump()[KEY]).toEqual({ version: 1, data: { total: 7, label: 'old' } });

    await repo.update((current) => current);
    expect(store.dump()[KEY]).toEqual({ version: 2, data: { count: 7, label: 'old' } });
    expect(await repo.read()).toEqual(upgraded);
  });

  it('treats an older version without an upgrade path as invalid', async () => {
    const store = createMemoryStore({ [KEY]: { version: 1, data: { count: 1 } } });
    const repo = createRepo(store, createQueue(), { ...definition, upgrade: undefined });

    const result = await repo.read();
    expect(result.status === 'invalid' && result.reason).toBe('schema-mismatch');
  });
});

describe('repo writes', () => {
  it('refuses to overwrite data written by a newer version', async () => {
    const newer = { version: 3, data: { count: 9, label: 'from the future' } };
    const { repo, store } = setup(newer);

    const read = await repo.read();
    expect(read.status === 'invalid' && read.readOnly).toBe(true);
    // Still shows the newer data when this version can parse it.
    expect(read.value).toEqual({ count: 9, label: 'from the future' });

    await expect(repo.update(() => ({ count: 0, label: 'x' }))).rejects.toBeInstanceOf(
      ReadOnlyRecordError,
    );
    expect(store.dump()[KEY]).toEqual(newer);
  });

  it('backs up an unreadable value before replacing it', async () => {
    const broken = { version: 2, data: { count: 'many' } };
    const { repo, store } = setup(broken);

    const result = await repo.update((current) => ({ ...current, label: 'fixed' }));

    expect(result).toEqual({ value: { count: 0, label: 'fixed' }, quarantined: true });
    const backups = await readQuarantine(store, KEY);
    expect(backups).toHaveLength(1);
    expect(backups[0]?.raw).toEqual(broken);
  });

  it('does not back anything up when the stored value was fine', async () => {
    const { repo, store } = setup({ version: 2, data: { count: 1, label: 'ok' } });

    const result = await repo.update((current) => ({ ...current, count: 2 }));

    expect(result.quarantined).toBe(false);
    expect(await readQuarantine(store, KEY)).toEqual([]);
  });

  it('rejects a change that would store an invalid value, leaving storage untouched', async () => {
    const stored = { version: 2, data: { count: 1, label: 'ok' } };
    const { repo, store } = setup(stored);

    await expect(repo.update(() => ({ count: 1.5, label: 'ok' }))).rejects.toThrow();
    expect(store.dump()[KEY]).toEqual(stored);
  });
});

describe('updates that span several keys', () => {
  const Counter = z.looseObject({ count: z.number().int().default(0) });
  const counter = (key: StorageKey): RecordDefinition<z.infer<typeof Counter>> => ({
    key,
    version: 1,
    schema: Counter,
    defaults: () => ({ count: 0 }),
  });

  it('run in one queued task, so no other write lands between them', async () => {
    const store = createMemoryStore();
    const queue = createQueue();
    const first = createRepo(store, queue, counter('local:first'));
    const second = createRepo(store, queue, counter('local:second'));
    const order: string[] = [];

    const together = queue(async () => {
      await first.updateLocked(() => ({ count: 1 }));
      order.push('first');
      await second.updateLocked(() => ({ count: 1 }));
      order.push('second');
    });
    const other = first.update(({ count }) => {
      order.push('other');
      return { count: count + 10 };
    });
    await Promise.all([together, other]);

    expect(order).toEqual(['first', 'second', 'other']);
    expect(store.dump()).toEqual({
      'local:first': { version: 1, data: { count: 11 } },
      'local:second': { version: 1, data: { count: 1 } },
    });
  });

  it('keep the same guards: a newer version is refused, an unreadable value backed up', async () => {
    const store = createMemoryStore({
      'local:first': { version: 9, data: { count: 1 } },
      'local:second': 'broken',
    });
    const queue = createQueue();

    await expect(
      queue(() =>
        createRepo(store, queue, counter('local:first')).updateLocked(() => ({ count: 2 })),
      ),
    ).rejects.toBeInstanceOf(ReadOnlyRecordError);
    expect(
      await queue(() =>
        createRepo(store, queue, counter('local:second')).updateLocked(() => ({ count: 2 })),
      ),
    ).toEqual({ value: { count: 2 }, quarantined: true });
    expect((await readQuarantine(store, 'local:second')).map((entry) => entry.raw)).toEqual([
      'broken',
    ]);
  });
});
