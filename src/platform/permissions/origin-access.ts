import { browser } from 'wxt/browser';
import { originPattern } from '@/domain/url';
import { createLogger } from '@/platform/logger';

const logger = createLogger('permissions');

/**
 * Asks for access to the origin of `baseURL` (and nothing wider). Chrome shows
 * the prompt only during a user gesture, so call this synchronously from the
 * click or submit handler, before any `await` (docs/development-plan.md §4.2).
 *
 * Resolves to whether access is held afterwards. A refusal is not an error:
 * the configuration is saved either way, because a service that allows
 * cross-origin requests works without the permission.
 */
export function requestOriginAccess(baseURL: string): Promise<boolean> {
  return browser.permissions
    .request({ origins: [originPattern(baseURL)] })
    .catch((error: unknown) => {
      logger.warn('Could not request access to', baseURL, error);
      return false;
    });
}

export function hasOriginAccess(baseURL: string): Promise<boolean> {
  return browser.permissions
    .contains({ origins: [originPattern(baseURL)] })
    .catch((error: unknown) => {
      logger.warn('Could not check access to', baseURL, error);
      return false;
    });
}
