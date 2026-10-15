import { createLatestOnly } from './latest-only';

export interface ModelSwitcherDeps {
  /** Makes `id` the default: the `models.choose` RPC. */
  choose: (id: string) => Promise<unknown>;
  /** The newest pick is stored: go on with it. */
  chosen: () => void;
  /** The newest pick could not be stored. */
  failed: (error: unknown) => void;
}

/**
 * The panel's model menu, picked from quickly. Picks are sent one at a time,
 * in the order they were made, so the default the background keeps is the
 * last one picked. A pick that a newer one replaced before its turn is not
 * sent at all, and only the newest pick's answer counts: it alone goes on or
 * reports a failure (see `createLatestOnly`).
 */
export function createModelSwitcher(deps: ModelSwitcherDeps): (id: string) => void {
  return createLatestOnly({ send: deps.choose, settled: () => deps.chosen(), failed: deps.failed });
}
