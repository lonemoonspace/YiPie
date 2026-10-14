import { browser } from 'wxt/browser';

/** The part of a storage area the gate uses; tests pass a fake. */
export interface AccessLevelArea {
  setAccessLevel(options: { accessLevel: 'TRUSTED_CONTEXTS' }): Promise<void>;
}

/**
 * Returns a function that resolves once `storage.local` (where API keys will
 * live) is closed to content scripts.
 *
 * Chrome exposes `storage.local` to content scripts by default, so a
 * compromised renderer of any page we inject into could read every key. With
 * the access level at `TRUSTED_CONTEXTS`, only the service worker and
 * extension pages can (docs/development-plan.md §2.2 凭据隔离).
 *
 * This is a gate, and it fails closed: whatever needs the isolation awaits it
 * and must not proceed when it rejects. Only a success is remembered; after a
 * failure, the next call asks the browser again.
 */
export function createIsolationGate(area: AccessLevelArea): () => Promise<void> {
  let confirmed: Promise<void> | undefined;

  // An async function turns a synchronous throw (an API this browser lacks)
  // into a rejection, so callers only ever see a promise.
  const restrict = async () => {
    await area.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  };

  return () =>
    (confirmed ??= restrict().catch((error: unknown) => {
      confirmed = undefined;
      throw error;
    }));
}

let gate: (() => Promise<void>) | undefined;

/** The background's gate over this extension's `storage.local`. */
export function ensureLocalStorageIsolated(): Promise<void> {
  gate ??= createIsolationGate(browser.storage.local);
  return gate();
}
