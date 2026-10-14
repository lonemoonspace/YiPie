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

/**
 * Gives back host permissions (patterns) that no configuration uses any more
 * (docs/development-plan.md §4.3, decision 5). Resolves to the patterns
 * actually given back; one that was not held is skipped, and a failure is
 * logged and skipped. Needs no user gesture.
 */
export async function releaseOriginAccess(
  patterns: readonly string[],
  permissions: PermissionsLike = browser.permissions,
): Promise<string[]> {
  const released: string[] = [];
  for (const pattern of patterns) {
    try {
      const origins = [pattern];
      if ((await permissions.contains({ origins })) && (await permissions.remove({ origins }))) {
        released.push(pattern);
      }
    } catch (error) {
      logger.warn('Could not give back access to', pattern, error);
    }
  }
  return released;
}
