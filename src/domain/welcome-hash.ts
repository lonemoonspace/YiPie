/**
 * The first-run page is the settings page with the hash `#welcome`, or
 * `#welcome/<path>` to open one of its ways in (docs/development-plan.md
 * §4.8). Kept apart from domain/onboarding, which brings the page's message
 * table: the service worker opens this page too.
 */

/** Which way into the first-run page: the panel links straight to one. */
export type StartPath = 'key' | 'free' | 'local';

export const START_PATHS: readonly StartPath[] = ['key', 'free', 'local'];

/** The hash of the first-run page, `#welcome` or `#welcome/<path>`. */
export function welcomeHash(path?: StartPath): string {
  return path === undefined ? '#welcome' : `#welcome/${path}`;
}

/**
 * Reads the settings page's hash: whether it asks for the first-run page,
 * and on which path. Null for any other hash (a section link).
 */
export function parseWelcomeHash(hash: string): { path: StartPath | null } | null {
  const match = /^#welcome(?:\/(\w+))?$/.exec(hash);
  if (match === null) return null;
  const path = START_PATHS.find((candidate) => candidate === match[1]) ?? null;
  return { path };
}
