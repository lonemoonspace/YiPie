export interface LatestOnlyDeps<T, R> {
  /** Sends one value: an RPC whose effect depends on the order it is stored in. */
  send: (value: T) => Promise<R>;
  /** The newest value was sent and answered. */
  settled: (result: R) => void;
  /** The newest value could not be sent. */
  failed: (error: unknown) => void;
}

/**
 * Sends values one at a time, in the order they were given, and only the
 * newest one counts. Two RPCs sent together could reach the background's
 * write queue in either order, because the background checks each sender
 * before queueing; one at a time, the background stores the last one given.
 * A value that a newer one replaced before its turn is not sent at all, and
 * only the newest value's answer is reported.
 *
 * The panel's model menu (the default model) and its conversation saves (the
 * whole conversation each time) both work this way.
 */
export function createLatestOnly<T, R>(deps: LatestOnlyDeps<T, R>): (value: T) => void {
  let newest = 0;
  let previous: Promise<void> = Promise.resolve();

  return (value) => {
    const ticket = ++newest;
    const isNewest = () => ticket === newest;
    previous = previous.then(async () => {
      if (!isNewest()) return;
      try {
        const result = await deps.send(value);
        if (isNewest()) deps.settled(result);
      } catch (error) {
        if (isNewest()) deps.failed(error);
      }
    });
  };
}
