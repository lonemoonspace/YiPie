/**
 * Runs read-modify-write tasks one at a time.
 *
 * Every write is "read the whole value → change it → write it back". Two of
 * those interleaving lose an update: both read the same value, and the later
 * write drops the earlier change. All writes happen in the service worker and
 * go through one queue (docs/development-plan.md §2.2), so they cannot
 * interleave.
 */
export type Queue = <T>(task: () => Promise<T>) => Promise<T>;

export function createQueue(): Queue {
  let tail: Promise<unknown> = Promise.resolve();

  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task);
    // A failed task must not wedge the tasks queued after it.
    tail = run.catch(() => undefined);
    return run;
  };
}
