import { browser } from 'wxt/browser';

/**
 * Closes `storage.local` (where API keys live) to content scripts.
 *
 * Chrome exposes `storage.local` to content scripts by default, so a
 * compromised renderer of any page we inject into could read every key. With
 * the access level at `TRUSTED_CONTEXTS`, only the service worker and
 * extension pages can (docs/development-plan.md §2.2 凭据隔离). The setting is
 * applied on every service-worker start.
 */
export function restrictLocalStorageToExtensionPages(): Promise<void> {
  return browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
}
