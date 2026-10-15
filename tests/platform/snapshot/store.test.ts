import { describe, expect, it } from 'vitest';
import {
  SNAPSHOT_INDEX_KEY,
  SNAPSHOT_PAGE_BYTES,
  SNAPSHOT_TOTAL_BYTES,
  snapshotKey,
  type SnapshotMessage,
} from '@/contract/snapshot';
import type { StorageKey } from '@/contract/storage';
import {
  byteSize,
  createSnapshotStore,
  fitPage,
  SnapshotTooLargeError,
  type SnapshotLimits,
} from '@/platform/snapshot/store';
import { createQueue, type StorageLike } from '@/platform/storage';
import { createMemoryStore, type MemoryStore } from '../../helpers/memory-store';

const PAGE = 'https://example.com/post';

const answer = (content: string, stopped = false): SnapshotMessage => ({
  role: 'assistant',
  content,
  stopped,
  usage: null,
});
const question = (content: string): SnapshotMessage => ({ role: 'user', content });

/** A conversation of about `bytes` bytes: one answer. */
const sized = (bytes: number) => [answer('x'.repeat(bytes))];

function setup(limits?: Partial<SnapshotLimits>, base: StorageLike = createMemoryStore()) {
  let id = 0;
  let clock = 1_000;
  const snapshots = createSnapshotStore(base, createQueue(), {
    newId: () => `s${++id}`,
    now: () => clock++,
    limits: {
      totalBytes: SNAPSHOT_TOTAL_BYTES,
      pageBytes: SNAPSHOT_PAGE_BYTES,
      evictedLimit: 200,
      ...limits,
    },
  });
  return { snapshots };
}

function withStore(limits?: Partial<SnapshotLimits>) {
  const store = createMemoryStore();
  return { store, ...setup(limits, store) };
}

const keys = (store: MemoryStore) => Object.keys(store.dump()).sort();

describe('snapshot store', () => {
  it('saves a conversation and restores it for the same tab and page only', async () => {
    const { snapshots } = withStore();
    const messages = [answer('总结'), question('追问'), answer('回答', true)];

    expect(await snapshots.save(1, PAGE, messages)).toEqual({ truncated: false });

    expect(await snapshots.get(1, PAGE)).toEqual({ status: 'found', messages, truncated: false });
    expect(await snapshots.get(2, PAGE)).toEqual({ status: 'none' });
    expect(await snapshots.get(1, `${PAGE}/other`)).toEqual({ status: 'none' });
  });

  it('replaces what was saved for the page, under the same key', async () => {
    const { snapshots, store } = withStore();
    await snapshots.save(1, PAGE, [answer('第一版')]);
    await snapshots.save(1, PAGE, [answer('第一版'), question('问'), answer('答')]);

    expect(keys(store)).toEqual([snapshotKey('s1'), SNAPSHOT_INDEX_KEY]);
    expect(await snapshots.get(1, PAGE)).toMatchObject({ status: 'found' });
    const lookup = await snapshots.get(1, PAGE);
    expect(lookup.status === 'found' && lookup.messages).toHaveLength(3);
  });

  it('lives in session storage, in envelopes, and records each size', async () => {
    const { snapshots, store } = withStore();
    await snapshots.save(1, PAGE, [answer('总结')]);

    expect(SNAPSHOT_INDEX_KEY.startsWith('session:')).toBe(true);
    expect(snapshotKey('s1').startsWith('session:')).toBe(true);
    const stored = store.dump() as Record<StorageKey, { version: number; data: unknown }>;
    const snapshot = stored[snapshotKey('s1')];
    expect(snapshot?.version).toBe(1);
    expect(snapshot?.data).toEqual({
      pageKey: PAGE,
      messages: [answer('总结')],
      updatedAt: 1_000,
      truncated: false,
    });
    expect(stored[SNAPSHOT_INDEX_KEY]?.data).toEqual([
      {
        id: 's1',
        tabId: 1,
        pageKey: PAGE,
        usedAt: 1_000,
        bytes: byteSize(snapshot?.data),
        evicted: false,
      },
    ]);
  });

  it('keeps saves of different tabs that arrive together', async () => {
    const { snapshots } = withStore();

    await Promise.all([
      snapshots.save(1, PAGE, [answer('一')]),
      snapshots.save(2, PAGE, [answer('二')]),
      snapshots.save(3, PAGE, [answer('三')]),
    ]);

    for (const tab of [1, 2, 3]) {
      expect((await snapshots.get(tab, PAGE)).status).toBe('found');
    }
  });
});

describe('snapshot store: the global budget', () => {
  const size = byteSize({
    pageKey: PAGE,
    messages: sized(1_000),
    updatedAt: 1_000,
    truncated: false,
  });

  it('evicts the least recently used conversations of any tab to make room', async () => {
    const { snapshots, store } = withStore({ totalBytes: size * 3 });
    await snapshots.save(1, PAGE, sized(1_000));
    await snapshots.save(2, PAGE, sized(1_000));
    await snapshots.save(3, PAGE, sized(1_000));

    // Tab 1's conversation is restored, so tab 2's is now the oldest in use.
    await snapshots.get(1, PAGE);
    await snapshots.save(4, PAGE, sized(1_000));

    expect(await snapshots.get(2, PAGE)).toEqual({ status: 'evicted' });
    for (const tab of [1, 3, 4]) expect((await snapshots.get(tab, PAGE)).status).toBe('found');
    // The evicted conversation's key is gone; its entry only remembers it.
    expect(keys(store)).not.toContain(snapshotKey('s2'));
  });

  it('evicts as many as it takes, oldest first, and never the one being saved', async () => {
    const { snapshots } = withStore({ totalBytes: size * 4 });
    for (const tab of [1, 2, 3, 4]) await snapshots.save(tab, PAGE, sized(1_000));

    // About two of the others' size: two of them have to go.
    await snapshots.save(5, PAGE, sized(2_000));

    expect((await snapshots.get(1, PAGE)).status).toBe('evicted');
    expect((await snapshots.get(2, PAGE)).status).toBe('evicted');
    expect((await snapshots.get(3, PAGE)).status).toBe('found');
    expect((await snapshots.get(4, PAGE)).status).toBe('found');
    expect((await snapshots.get(5, PAGE)).status).toBe('found');
  });

  it('starts afresh after an eviction: the page saves again', async () => {
    const { snapshots } = withStore({ totalBytes: size * 2 });
    await snapshots.save(1, PAGE, sized(1_000));
    await snapshots.save(2, PAGE, sized(1_000));
    await snapshots.save(3, PAGE, sized(1_000));
    expect((await snapshots.get(1, PAGE)).status).toBe('evicted');

    await snapshots.save(1, PAGE, [answer('新的总结')]);

    expect(await snapshots.get(1, PAGE)).toMatchObject({
      status: 'found',
      messages: [answer('新的总结')],
    });
  });

  it('remembers a bounded number of evicted conversations', async () => {
    const { snapshots, store } = withStore({ totalBytes: size, evictedLimit: 2 });
    for (const tab of [1, 2, 3, 4, 5]) await snapshots.save(tab, PAGE, sized(1_000));

    const index = (store.dump()[SNAPSHOT_INDEX_KEY] as { data: { tabId: number }[] }).data;
    expect(index.map((entry) => entry.tabId)).toEqual([3, 4, 5]);
    expect((await snapshots.get(1, PAGE)).status).toBe('none');
    expect((await snapshots.get(4, PAGE)).status).toBe('evicted');
  });
});

describe('snapshot store: the page limit', () => {
  it('drops the oldest exchanges beyond it, still starting with an answer, and says so', async () => {
    const messages = [
      answer('a'.repeat(400)),
      question('q'.repeat(400)),
      answer('b'.repeat(400)),
      question('r'.repeat(400)),
      answer('c'.repeat(400)),
    ];
    const { snapshots } = withStore({ pageBytes: 1_500 });

    expect(await snapshots.save(1, PAGE, messages)).toEqual({ truncated: true });

    expect(await snapshots.get(1, PAGE)).toEqual({
      status: 'found',
      messages: messages.slice(2),
      truncated: true,
    });
  });

  it('refuses, visibly, a conversation whose latest answer alone is over the limit', async () => {
    const { snapshots, store } = withStore({ pageBytes: 500 });

    await expect(snapshots.save(1, PAGE, [answer('x'.repeat(600))])).rejects.toBeInstanceOf(
      SnapshotTooLargeError,
    );
    expect(store.dump()).toEqual({});
  });

  it('measures exactly what it stores', () => {
    const messages = [answer('总结 😀'), question('"引号"\n换行'), answer('回答')];
    for (let limit = 0; limit < 400; limit += 7) {
      const fitted = fitPage(PAGE, messages, 1_000, limit);
      if (fitted === null) continue;
      expect(fitted.bytes).toBe(byteSize(fitted.snapshot));
      expect(fitted.bytes).toBeLessThanOrEqual(limit);
      expect(fitted.snapshot.messages[0]?.role).toBe('assistant');
    }
  });
});

describe('snapshot store: failures and cleanup', () => {
  /** Session storage that refuses every conversation write, as when it is full. */
  function failingStore(): MemoryStore {
    const store = createMemoryStore();
    return {
      ...store,
      async set(key, value) {
        if (key.startsWith('session:snapshot:'))
          throw new Error('Session storage quota bytes exceeded.');
        await store.set(key, value);
      },
    };
  }

  it('reports a failed write to the caller, and does not claim the conversation was saved', async () => {
    const store = failingStore();
    const { snapshots } = setup({}, store);

    await expect(snapshots.save(1, PAGE, [answer('总结')])).rejects.toThrow('quota');

    expect(await snapshots.get(1, PAGE)).toEqual({ status: 'none' });
    expect((store.dump()[SNAPSHOT_INDEX_KEY] as { data: unknown[] }).data).toEqual([]);
  });

  it('keeps the earlier conversation when replacing it fails', async () => {
    const base = createMemoryStore();
    let refuse = false;
    const store: StorageLike = {
      ...base,
      async set(key, value) {
        if (refuse && key.startsWith('session:snapshot:')) throw new Error('quota');
        await base.set(key, value);
      },
    };
    const { snapshots } = setup({}, store);
    await snapshots.save(1, PAGE, [answer('第一版')]);

    refuse = true;
    await expect(snapshots.save(1, PAGE, [answer('第二版')])).rejects.toThrow('quota');

    expect(await snapshots.get(1, PAGE)).toMatchObject({
      status: 'found',
      messages: [answer('第一版')],
    });
  });

  it('reads an entry whose conversation is missing as nothing saved', async () => {
    const { snapshots, store } = withStore();
    await snapshots.save(1, PAGE, [answer('总结')]);
    await store.remove(snapshotKey('s1'));

    expect(await snapshots.get(1, PAGE)).toEqual({ status: 'none' });
  });

  it('deletes every conversation of a closed tab, and only those', async () => {
    const { snapshots, store } = withStore();
    await snapshots.save(1, PAGE, [answer('一')]);
    await snapshots.save(1, `${PAGE}#/other`, [answer('一，另一页')]);
    await snapshots.save(2, PAGE, [answer('二')]);

    await snapshots.removeTab(1);
    await snapshots.removeTab(9);

    expect(await snapshots.get(1, PAGE)).toEqual({ status: 'none' });
    expect(await snapshots.get(1, `${PAGE}#/other`)).toEqual({ status: 'none' });
    expect((await snapshots.get(2, PAGE)).status).toBe('found');
    expect(keys(store)).toEqual([snapshotKey('s3'), SNAPSHOT_INDEX_KEY]);
  });
});
