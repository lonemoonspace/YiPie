export interface ModelSwitcherDeps {
  /** Makes `id` the default: the `models.choose` RPC. */
  choose: (id: string) => Promise<unknown>;
  /** The newest pick is stored: summarize with it. */
  chosen: () => void;
  /** The newest pick could not be stored. */
  failed: (error: unknown) => void;
}

/**
 * The panel's model menu, picked from quickly. Picks are sent one at a time,
 * in the order they were made, so the default the background keeps is the
 * last one picked: two picks sent together could reach its write queue in
 * either order, because the background checks each sender before queueing.
 * A pick that a newer one replaced before its turn is not sent at all, and
 * only the newest pick's answer counts: it alone starts a summary or reports
 * a failure.
 */
export function createModelSwitcher(deps: ModelSwitcherDeps): (id: string) => void {
  let newest = 0;
  let previous: Promise<void> = Promise.resolve();

  return (id) => {
    const pick = ++newest;
    const isNewest = () => pick === newest;
    previous = previous.then(async () => {
      if (!isNewest()) return;
      try {
        await deps.choose(id);
        if (isNewest()) deps.chosen();
      } catch (error) {
        if (isNewest()) deps.failed(error);
      }
    });
  };
}
