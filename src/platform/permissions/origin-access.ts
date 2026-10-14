import { browser } from 'wxt/browser';
import { originPattern } from '@/domain/url';
import { createLogger } from '@/platform/logger';

const logger = createLogger('permissions');

/** The part of `browser.permissions` used here. */
export interface PermissionsLike {
  request(permissions: { origins: string[] }): Promise<boolean>;
  contains(permissions: { origins: string[] }): Promise<boolean>;
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

export function hasOriginAccess(
  baseURL: string,
  permissions: PermissionsLike = browser.permissions,
): Promise<boolean> {
  const pattern = originPattern(baseURL);
  return permissions.contains({ origins: [pattern] }).catch((error: unknown) => {
    logger.warn('Could not check access to', pattern, error);
    return false;
  });
}
