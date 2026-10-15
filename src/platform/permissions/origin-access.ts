import { browser } from 'wxt/browser';
import { originPattern } from '@/domain/url';
import { createLogger } from '@/platform/logger';

const logger = createLogger('permissions');

/** The part of `browser.permissions` used here. */
export interface PermissionsLike {
  request(permissions: { origins: string[] }): Promise<boolean>;
  contains(permissions: { origins: string[] }): Promise<boolean>;
  remove(permissions: { origins: string[] }): Promise<boolean>;
}

/**
 * Asks for access to the origin of `baseURL` (and nothing wider). Chrome shows
 * the prompt only during a user gesture, so call this synchronously from the
 * click or submit handler, before any `await` (docs/development-plan.md §4.2).
 *
 * Resolves to whether access is held afterwards. A refusal is not an error:
 * the configuration is saved either way, because a service that allows
 * cross-origin requests works without the permission.
 */
export function requestOriginAccess(
  baseURL: string,
  permissions: PermissionsLike = browser.permissions,
): Promise<boolean> {
  const pattern = originPattern(baseURL);
  return permissions.request({ origins: [pattern] }).catch((error: unknown) => {
    // The origin only: the base URL's query may carry a key.
    logger.warn('Could not request access to', pattern, error);
    return false;
  });
}

/**
 * `requestOriginAccess` for several base URLs at once (an import): one prompt
 * for all their origins, since the browser shows one per user gesture.
 */
export function requestOriginsAccess(
  baseURLs: readonly string[],
  permissions: PermissionsLike = browser.permissions,
): Promise<boolean> {
  const origins = [...new Set(baseURLs.map(originPattern))];
  if (origins.length === 0) return Promise.resolve(true);
  return permissions.request({ origins }).catch((error: unknown) => {
    logger.warn('Could not request access to', origins.join(', '), error);
    return false;
  });
}

export function hasOriginAccess(
  baseURL: string,
  permissions: PermissionsLike = browser.permissions,
): Promise<boolean> {
  return hasPatternAccess(originPattern(baseURL), permissions);
}

/** Whether we hold access to an origin pattern (`originPattern`). */
export function hasPatternAccess(
  pattern: string,
  permissions: PermissionsLike = browser.permissions,
): Promise<boolean> {
  return permissions.contains({ origins: [pattern] }).catch((error: unknown) => {
    logger.warn('Could not check access to', pattern, error);
    return false;
  });
}

/**
 * Gives back access to origin patterns no configuration uses any more
 * (docs/development-plan.md §4.3, decision 5). Runs in the service worker,
 * right after the change that freed them; no user gesture is needed to give
 * a permission up. One pattern at a time, so one the browser will not drop
 * (a permission the manifest requires, in the E2E build) does not keep the
 * others. Never throws: the change itself has already happened.
 */
export async function releaseOriginAccess(
  patterns: readonly string[],
  permissions: PermissionsLike = browser.permissions,
): Promise<void> {
  for (const pattern of patterns) {
    try {
      await permissions.remove({ origins: [pattern] });
      logger.info('Released access to', pattern);
    } catch (error) {
      logger.warn('Could not release access to', pattern, error);
    }
  }
}

/** Calls `listener` whenever this extension gains or loses a permission; returns the unsubscribe. */
export function onPermissionsChanged(listener: () => void): () => void {
  browser.permissions.onAdded.addListener(listener);
  browser.permissions.onRemoved.addListener(listener);
  return () => {
    browser.permissions.onAdded.removeListener(listener);
    browser.permissions.onRemoved.removeListener(listener);
  };
}
