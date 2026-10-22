import {
  PANEL_REGISTRY_KEY,
  PANEL_REGISTRY_LIMIT,
  PANEL_REGISTRY_VERSION,
  PanelRegistry,
} from '@/contract/panel-registry';
import type { PanelMode } from '@/contract/rpc-wire';
import { createRepo, type Queue, type StorageLike } from '@/platform/storage';

export interface PanelRegistryService {
  /**
   * A fresh nonce for the panel frame about to be mounted in `tabId`, on the
   * page `pageKey`, to work on `mode`; replaces any earlier one.
   */
  issue(tabId: number, pageKey: string, mode?: PanelMode): Promise<string>;
  /**
   * Binds the tab's current nonce to the document presenting it. False when
   * the nonce does not match or another document already presented it.
   */
  attach(tabId: number, nonce: string, documentId: string): Promise<boolean>;
  /** Whether `documentId` is the panel attached in `tabId`. */
  isAttached(tabId: number, documentId: string): Promise<boolean>;
  /**
   * Runs `task` in its own slot of the write queue if `documentId` is still
   * the panel attached in `tabId` there, and says whether it ran. For a
   * panel's write: asked in the queue, a panel replaced while the write
   * waited does not change what the new one sees (§4.4, detail 7). `task`
   * is already in the queue, so it uses the services' `…Unqueued` methods.
   */
  whileAttached<T>(
    tabId: number,
    documentId: string,
    task: () => Promise<T>,
  ): Promise<{ attached: true; value: T } | { attached: false }>;
  /** The page of the panel `documentId` attached in `tabId`; null when it is not the one attached. */
  pageKeyOf(tabId: number, documentId: string): Promise<string | null>;
  /** What the panel `documentId` attached in `tabId` works on; null when it is not the one attached. */
  modeOf(tabId: number, documentId: string): Promise<PanelMode | null>;
  /** Forgets a tab that was closed. */
  remove(tabId: number): Promise<void>;
}

/** The registry behind `content.hello` and `panel.attach`; runs in the service worker. */
export function createPanelRegistry(
  store: StorageLike,
  queue: Queue,
  newNonce: () => string = () => crypto.randomUUID(),
  now: () => number = () => Date.now(),
): PanelRegistryService {
  const repo = createRepo(store, queue, {
    key: PANEL_REGISTRY_KEY,
    version: PANEL_REGISTRY_VERSION,
    schema: PanelRegistry,
    defaults: (): PanelRegistry => ({}),
  });

  const isAttached = async (tabId: number, documentId: string) => {
    const { value } = await repo.read();
    return value[String(tabId)]?.attachedDocument === documentId;
  };

  return {
    async issue(tabId, pageKey, mode = 'page') {
      const nonce = newNonce();
      await repo.update((registry) =>
        keepNewest({
          ...registry,
          [String(tabId)]: { nonce, issuedAt: now(), attachedDocument: null, pageKey, mode },
        }),
      );
      return nonce;
    },

    async attach(tabId, nonce, documentId) {
      let attached = false;
      await repo.update((registry) => {
        const entry = registry[String(tabId)];
        if (entry === undefined || entry.nonce !== nonce) return registry;
        // The same document may present its nonce again; a different one may not.
        if (entry.attachedDocument !== null) {
          attached = entry.attachedDocument === documentId;
          return registry;
        }
        attached = true;
        return { ...registry, [String(tabId)]: { ...entry, attachedDocument: documentId } };
      });
      return attached;
    },

    isAttached,

    whileAttached(tabId, documentId, task) {
      return queue(async () =>
        (await isAttached(tabId, documentId))
          ? { attached: true as const, value: await task() }
          : { attached: false as const },
      );
    },

    async pageKeyOf(tabId, documentId) {
      const entry = (await repo.read()).value[String(tabId)];
      return entry?.attachedDocument === documentId ? entry.pageKey : null;
    },

    async modeOf(tabId, documentId) {
      const entry = (await repo.read()).value[String(tabId)];
      return entry?.attachedDocument === documentId ? entry.mode : null;
    },

    async remove(tabId) {
      await repo.update((registry) =>
        Object.fromEntries(Object.entries(registry).filter(([id]) => id !== String(tabId))),
      );
    },
  };
}

/** Drops the oldest entries beyond the limit (closed tabs leave theirs behind). */
function keepNewest(registry: PanelRegistry): PanelRegistry {
  const entries = Object.entries(registry);
  if (entries.length <= PANEL_REGISTRY_LIMIT) return registry;
  return Object.fromEntries(
    entries.sort(([, a], [, b]) => b.issuedAt - a.issuedAt).slice(0, PANEL_REGISTRY_LIMIT),
  );
}
