import { describe, expect, it } from 'vitest';
import {
  SNAPSHOT_INDEX_KEY,
  SNAPSHOT_PAGE_BYTES,
  SNAPSHOT_TOTAL_BYTES,
  snapshotKey,
  type SnapshotIndex,
  type SnapshotMessage,
} from '@/contract/snapshot';
import type { StorageKey } from '@/contract/storage';
import {
  byteSize,
  createSnapshotStore,
  fitPage,
  SnapshotTooLargeError,
  type SnapshotLimits,
  type SnapshotRevision,
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
  let revision = 0;
  const inner = createSnapshotStore(base, createQueue(), {
    newId: () => `s${++id}`,
    now: () => clock++,
    limits: {
      totalBytes: SNAPSHOT_TOTAL_BYTES,
      pageBytes: SNAPSHOT_PAGE_BYTES,
      evictedLimit: 200,
      ...limits,
    },
  });
  // Unless a test says otherwise, each save comes from the tab's panel and
  // is newer than every save before it.
  const snapshots = {
    ...inner,
    save: (tabId: number, pageKey: string, messages: SnapshotMessage[], owner?: SnapshotRevision) =>
      inner.save(
        tabId,
        pageKey,
        messages,
        owner ?? { documentId: `doc-${tabId}`, revision: ++revision },
      ),
  };
  return { snapshots };
}

function withStore(limits?: Partial<SnapshotLimits>) {
  const store = createMemoryStore();
  return { store, ...setup(limits, store) };
}

/**
 * One session's storage, and the store as each start of the worker runs it:
 * ids and the clock carry on from one start to the next, as they would.
 */
function createWorld(limits?: Partial<SnapshotLimits>) {
  const base = createMemoryStore();
  let id = 0;
  let clock = 1_000;
  let revision = 0;
  const start = (store: StorageLike = base) => {
    const inner = createSnapshotStore(store, createQueue(), {
      newId: () => `s${++id}`,
      now: () => clock++,
      limits: {
        totalBytes: SNAPSHOT_TOTAL_BYTES,
        pageBytes: SNAPSHOT_PAGE_BYTES,
        evictedLimit: 200,
        ...limits,
      },
    });
    return {
      ...inner,
      save: (tabId: number, pageKey: string, messages: SnapshotMessage[]) =>
        inner.save(tabId, pageKey, messages, { documentId: `doc-${tabId}`, revision: ++revision }),
    };
  };
  return { base, start };
}
type Started = ReturnType<ReturnType<typeof createWorld>['start']>;

interface Write {
  /** Counted from 0, sets and removes alike. */
  index: number;
  kind: 'set' | 'remove';
  key: StorageKey;
}

/** `base`, refusing a write that would take it over `quota` bytes, as session storage does. */
function limited(base: MemoryStore, quota: number): StorageLike {
  return {
    get: (key) => base.get(key),
    remove: (key) => base.remove(key),
    async set(key, value) {
      const others = Object.entries(base.dump()).filter(([name]) => name !== key);
      const total = others.reduce((sum, [, item]) => sum + byteSize(item), byteSize(value));
      if (total > quota) throw new Error('Session storage quota bytes exceeded.');
      await base.set(key, value);
    },
  };
}

/**
 * `base`, with each write (set or remove) decided by `decide`: it goes
 * through, fails as a full storage does, or never returns, as when the worker
 * stops (and then nothing after it runs either).
 */
function scripted(base: StorageLike, decide: (write: Write) => 'write' | 'fail' | 'stop') {
  let count = 0;
  let onStop: () => void = () => undefined;
  const stopped = new Promise<void>((resolve) => {
    onStop = resolve;
  });
  const write = async (kind: Write['kind'], key: StorageKey, perform: () => Promise<void>) => {
    const outcome = decide({ index: count++, kind, key });
    if (outcome === 'fail') throw new Error('Session storage quota bytes exceeded.');
    if (outcome === 'stop') {
      onStop();
      await new Promise<never>(() => undefined);
    }
    await perform();
  };
  const store: StorageLike = {
    get: (key) => base.get(key),
    set: (key, value) => write('set', key, () => base.set(key, value)),
    remove: (key) => write('remove', key, () => base.remove(key)),
  };
  return { store, writes: () => count, stopped };
}

const keys = (store: MemoryStore) => Object.keys(store.dump()).sort();

/** The index as stored. */
const indexOf = (store: MemoryStore) =>
  (store.dump()[SNAPSHOT_INDEX_KEY] as { data: SnapshotIndex } | undefined)?.data ?? {
    entries: [],
    garbage: [],
  };

describe('snapshot store', () => {
  it('saves a conversation and restores it for the same tab and page only', async () => {
    const { snapshots } = withStore();
    const messages = [answer('总结'), question('追问'), answer('回答', true)];

    expect(await snapshots.save(1, PAGE, messages)).toEqual({ stored: true, truncated: false });

    expect(await snapshots.get(1, PAGE)).toEqual({ status: 'found', messages, truncated: false });
    expect(await snapshots.get(2, PAGE)).toEqual({ status: 'none' });
    expect(await snapshots.get(1, `${PAGE}/other`)).toEqual({ status: 'none' });
  });

  it('replaces what was saved for the page: a new key, and the old one deleted', async () => {
    const { snapshots, store } = withStore();
    await snapshots.save(1, PAGE, [answer('第一版')]);
    await snapshots.save(1, PAGE, [answer('第一版'), question('问'), answer('答')]);

    expect(keys(store)).toEqual([snapshotKey('s2'), SNAPSHOT_INDEX_KEY]);
    const lookup = await snapshots.get(1, PAGE);
    expect(lookup.status === 'found' && lookup.messages).toHaveLength(3);
    expect(indexOf(store).garbage).toEqual([]);
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
    expect(stored[SNAPSHOT_INDEX_KEY]?.data).toEqual({
      entries: [
        {
          id: 's1',
          tabId: 1,
          pageKey: PAGE,
          usedAt: 1_000,
          bytes: byteSize(snapshot?.data),
          evicted: false,
          documentId: 'doc-1',
          revision: 1,
        },
      ],
      garbage: [],
    });
  });

  it('leaves room in session storage for a save in progress', () => {
    // A save holds the new conversation and the ones it replaces at once.
    // storage.session holds 10 MiB for the whole extension (QUOTA_BYTES); the
    // panel registry and the index take the rest, and need far less.
    expect(SNAPSHOT_TOTAL_BYTES + SNAPSHOT_PAGE_BYTES).toBeLessThan(10 * 1024 * 1024 - 2_000_000);
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

    expect(indexOf(store).entries.map((entry) => entry.tabId)).toEqual([3, 4, 5]);
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

    expect(await snapshots.save(1, PAGE, messages)).toEqual({ stored: true, truncated: true });

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
    expect(indexOf(store)).toEqual({ entries: [], garbage: [] });
    expect(keys(store)).toEqual([SNAPSHOT_INDEX_KEY]);
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

describe('snapshot store: saves that arrive late', () => {
  const from = (documentId: string, revision: number) => ({ documentId, revision });

  it('keeps the newest save from a panel, whatever order they arrive in', async () => {
    const { snapshots } = withStore();
    await snapshots.save(1, PAGE, [answer('第二版')], from('doc-a', 2));

    expect(await snapshots.save(1, PAGE, [answer('第一版')], from('doc-a', 1))).toEqual({
      stored: false,
      truncated: false,
    });
    expect(await snapshots.save(1, PAGE, [answer('又一次第二版')], from('doc-a', 2))).toMatchObject(
      {
        stored: false,
      },
    );

    expect(await snapshots.get(1, PAGE)).toMatchObject({ messages: [answer('第二版')] });
  });

  it('takes any save from another panel document: the page was reloaded or the panel mounted again', async () => {
    const { snapshots } = withStore();
    await snapshots.save(1, PAGE, [answer('旧面板')], from('doc-a', 9));

    expect(await snapshots.save(1, PAGE, [answer('新面板')], from('doc-b', 1))).toMatchObject({
      stored: true,
    });

    expect(await snapshots.get(1, PAGE)).toMatchObject({ messages: [answer('新面板')] });
  });

  it('reads an emptied conversation as nothing saved, and a late older save cannot bring it back', async () => {
    const { snapshots } = withStore();
    await snapshots.save(1, PAGE, [answer('总结')], from('doc-a', 1));
    await snapshots.save(1, PAGE, [], from('doc-a', 3));

    expect(await snapshots.get(1, PAGE)).toEqual({ status: 'none' });
    expect(
      await snapshots.save(1, PAGE, [answer('总结'), question('问')], from('doc-a', 2)),
    ).toMatchObject({ stored: false });
    expect(await snapshots.get(1, PAGE)).toEqual({ status: 'none' });
  });

  it('keeps the order of saves for different pages and tabs apart', async () => {
    const { snapshots } = withStore();
    await snapshots.save(1, PAGE, [answer('甲')], from('doc-a', 5));

    expect(await snapshots.save(1, `${PAGE}#/b`, [answer('乙')], from('doc-a', 1))).toMatchObject({
      stored: true,
    });
    expect(await snapshots.save(2, PAGE, [answer('丙')], from('doc-c', 1))).toMatchObject({
      stored: true,
    });
  });
});

describe('snapshot store: a save that fails or stops part way', () => {
  const size = byteSize({
    pageKey: PAGE,
    messages: sized(1_000),
    updatedAt: 1_000,
    truncated: false,
  });
  const first = [answer('a'.repeat(1_000))];
  const second = [answer('a'.repeat(1_000)), question('问'), answer('b'.repeat(1_000))];
  const another = (tab: number) => [answer(String(tab).repeat(1_000))];
  const conversations = (store: MemoryStore) =>
    keys(store).filter((key) => key !== SNAPSHOT_INDEX_KEY);
  const pointedAt = (store: MemoryStore) =>
    indexOf(store)
      .entries.filter((entry) => !entry.evicted)
      .map((entry) => snapshotKey(entry.id));

  /**
   * Tabs 1, 2 and 3 have a conversation each and the budget is full. Tab 1
   * then saves a longer one: it replaces tab 1's and evicts tab 2's, the
   * least recently used.
   */
  async function prepare() {
    const world = createWorld({ totalBytes: size * 3 + 500 });
    const healthy = world.start();
    await healthy.save(1, PAGE, first);
    await healthy.save(2, PAGE, another(2));
    await healthy.save(3, PAGE, another(3));
    return world;
  }
  const replaceAndEvict = (snapshots: Started) => snapshots.save(1, PAGE, second);

  /**
   * The store holds what it held before the save, or all of the save: never
   * part of it, never the new entry with the old conversation. Every stored
   * conversation is one the index knows of. True when the save is there.
   */
  async function expectBeforeOrAfter(snapshots: Started, store: MemoryStore) {
    const one = await snapshots.get(1, PAGE);
    const two = await snapshots.get(2, PAGE);
    expect(await snapshots.get(3, PAGE)).toMatchObject({ status: 'found', messages: another(3) });
    const saved = one.status === 'found' && one.messages.length === second.length;
    if (saved) {
      expect(one).toEqual({ status: 'found', messages: second, truncated: false });
      expect(two).toEqual({ status: 'evicted' });
    } else {
      expect(one).toEqual({ status: 'found', messages: first, truncated: false });
      expect(two).toEqual({ status: 'found', messages: another(2), truncated: false });
    }
    const known = [...pointedAt(store), ...indexOf(store).garbage.map(snapshotKey)];
    expect(known).toEqual(expect.arrayContaining(conversations(store)));
    return saved;
  }

  /** One more save, and only the conversations entries point at are left. */
  async function expectCleanAfterNextSave(snapshots: Started, store: MemoryStore) {
    await snapshots.save(4, PAGE, [answer('四')]);
    expect(indexOf(store).garbage).toEqual([]);
    expect(conversations(store)).toEqual(pointedAt(store).sort());
  }

  /** How many writes the save takes when nothing goes wrong. */
  async function writesOfTheSave() {
    const world = await prepare();
    const counted = scripted(world.base, () => 'write');
    await replaceAndEvict(world.start(counted.store));
    return counted.writes();
  }

  it('writes the new conversation before it deletes anything', async () => {
    const world = await prepare();
    const order: string[] = [];
    const watched = scripted(world.base, ({ kind, key }) => {
      order.push(`${kind} ${key}`);
      return 'write';
    });

    await replaceAndEvict(world.start(watched.store));

    // List the new key, write it, point the page at it while listing what
    // it replaced, delete those, forget them.
    expect(order).toEqual([
      `set ${SNAPSHOT_INDEX_KEY}`,
      `set ${snapshotKey('s4')}`,
      `set ${SNAPSHOT_INDEX_KEY}`,
      `remove ${snapshotKey('s2')}`,
      `remove ${snapshotKey('s1')}`,
      `set ${SNAPSHOT_INDEX_KEY}`,
    ]);
    expect(conversations(world.base)).toEqual([snapshotKey('s3'), snapshotKey('s4')]);
  });

  it('stopped after any of its writes, leaves what was saved before or all of the save, and the next save cleans up', async () => {
    const writes = await writesOfTheSave();
    const outcomes: boolean[] = [];
    for (let stop = 0; stop < writes; stop += 1) {
      const world = await prepare();
      const stopping = scripted(world.base, ({ index }) => (index >= stop ? 'stop' : 'write'));
      void replaceAndEvict(world.start(stopping.store));
      await stopping.stopped;

      // The worker starts again.
      const restarted = world.start();
      outcomes.push(await expectBeforeOrAfter(restarted, world.base));
      await expectCleanAfterNextSave(restarted, world.base);
    }
    // Stopped before the index points at the new conversation, nothing
    // changed; from then on, the save is there.
    expect(outcomes).toEqual([false, false, false, true, true, true]);
  });

  it('failing at any of its writes, keeps what was saved before or reports the save, and the next save cleans up', async () => {
    const writes = await writesOfTheSave();
    for (let failing = 0; failing < writes; failing += 1) {
      const world = await prepare();
      const flaky = scripted(world.base, ({ index }) => (index === failing ? 'fail' : 'write'));
      const snapshots = world.start(flaky.store);

      const result = await replaceAndEvict(snapshots).catch((error: unknown) => error);

      const saved = await expectBeforeOrAfter(snapshots, world.base);
      expect(saved).toBe(failing >= 3);
      // It says it saved exactly when it did: deleting what it replaced may
      // fail without undoing the save.
      if (saved) expect(result).toEqual({ stored: true, truncated: false });
      else expect(result).toBeInstanceOf(Error);
      await expectCleanAfterNextSave(snapshots, world.base);
    }
  });

  it('evicts others to make room only once its own conversation is written', async () => {
    const world = createWorld({ totalBytes: size * 2 + 500 });
    const healthy = world.start();
    await healthy.save(1, PAGE, another(1));
    await healthy.save(2, PAGE, another(2));
    const full = scripted(world.base, ({ kind, key }) =>
      kind === 'set' && key !== SNAPSHOT_INDEX_KEY ? 'fail' : 'write',
    );
    const snapshots = world.start(full.store);

    // Tab 3's conversation needs tab 1's room, and cannot be written.
    await expect(snapshots.save(3, PAGE, another(3))).rejects.toThrow('quota');

    expect(await snapshots.get(1, PAGE)).toMatchObject({ status: 'found', messages: another(1) });
    expect(await snapshots.get(2, PAGE)).toMatchObject({ status: 'found', messages: another(2) });
    expect(await snapshots.get(3, PAGE)).toEqual({ status: 'none' });
    expect(indexOf(world.base).garbage).toEqual([]);
    expect(conversations(world.base)).toEqual([snapshotKey('s1'), snapshotKey('s2')]);
  });

  it('keeps a key it could not delete listed, and the next save deletes it', async () => {
    const world = createWorld();
    let refuse = true;
    const stuck = scripted(world.base, ({ kind }) =>
      kind === 'remove' && refuse ? 'fail' : 'write',
    );
    const snapshots = world.start(stuck.store);
    await snapshots.save(1, PAGE, first);

    expect(await snapshots.save(1, PAGE, second)).toEqual({ stored: true, truncated: false });
    expect(indexOf(world.base).garbage).toEqual(['s1']);
    expect(await snapshots.get(1, PAGE)).toMatchObject({ messages: second });

    refuse = false;
    await snapshots.save(2, PAGE, another(2));
    expect(indexOf(world.base).garbage).toEqual([]);
    expect(conversations(world.base)).toEqual([snapshotKey('s2'), snapshotKey('s3')]);
  });

  it('first deletes what an earlier save left behind, so it cannot crowd out the new one', async () => {
    const big = (fill: string, times = 1) => [answer(fill.repeat(10_000 * times))];
    const one = byteSize({ pageKey: PAGE, messages: big('a'), updatedAt: 1_000, truncated: false });
    // Room for one conversation and the one replacing it, and little more.
    const quota = one * 3.5;
    const world = createWorld();
    await world.start(limited(world.base, quota)).save(1, PAGE, big('a'));
    // The worker stops after the save that replaces it is in, before the
    // replaced conversation is deleted.
    const stopping = scripted(limited(world.base, quota), ({ index }) =>
      index >= 3 ? 'stop' : 'write',
    );
    void world.start(stopping.store).save(1, PAGE, big('b', 2));
    await stopping.stopped;

    const restarted = world.start(limited(world.base, quota));
    expect(await restarted.save(2, PAGE, big('c'))).toMatchObject({ stored: true });

    expect(conversations(world.base)).toEqual([snapshotKey('s2'), snapshotKey('s3')]);
    expect(await restarted.get(1, PAGE)).toMatchObject({ messages: big('b', 2) });
  });

  it('forgets a closed tab and lists its conversations in one write, so a stop leaves nothing behind', async () => {
    const world = createWorld();
    const healthy = world.start();
    await healthy.save(1, PAGE, first);
    await healthy.save(2, PAGE, another(2));
    const stopping = scripted(world.base, ({ index }) => (index >= 1 ? 'stop' : 'write'));
    void world.start(stopping.store).removeTab(1);
    await stopping.stopped;

    const restarted = world.start();
    expect(await restarted.get(1, PAGE)).toEqual({ status: 'none' });
    expect(indexOf(world.base).garbage).toEqual(['s1']);
    await restarted.save(3, PAGE, another(3));
    expect(conversations(world.base)).toEqual([snapshotKey('s2'), snapshotKey('s3')]);
  });
});
