import {
  PANEL_REGISTRY_KEY,
  PANEL_REGISTRY_LIMIT,
  PANEL_REGISTRY_VERSION,
  PanelRegistry,
} from '@/contract/panel-registry';
import { createRepo, type Queue, type StorageLike } from '@/platform/storage';

export interface PanelRegistryService {
  /** A fresh nonce for the panel frame about to be mounted in `tabId`; replaces any earlier one. */
  issue(tabId: number): Promise<string>;
  /**
   * Binds the tab's current nonce to the document presenting it. False when
   * the nonce does not match or another document already presented it.
   */
  attach(tabId: number, nonce: string, documentId: string): Promise<boolean>;
  /** Whether `documentId` is the panel attached in `tabId`. */
  isAttached(tabId: number, documentId: string): Promise<boolean>;
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

  return {
    async issue(tabId) {
      const nonce = newNonce();
      await repo.update((registry) =>
        keepNewest({
          ...registry,
          [String(tabId)]: { nonce, issuedAt: now(), attachedDocument: null },
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

    async isAttached(tabId, documentId) {
      const { value } = await repo.read();
      return value[String(tabId)]?.attachedDocument === documentId;
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
