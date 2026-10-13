import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createRepo } from '@/platform/storage/repo';
import { createQueue, type Queue } from '@/platform/storage/tx';
import { createMemoryStore } from '../../helpers/memory-store';

const Counter = z.object({ count: z.number().int() });

function incrementConcurrently(queue: Queue, times: number) {
  const store = createMemoryStore();
  const repo = createRepo(store, queue, {
    key: 'local:counter',
    version: 1,
    schema: Counter,
    defaults: () => ({ count: 0 }),
  });
  const updates = Array.from({ length: times }, () =>
    repo.update((current) => ({ count: current.count + 1 })),
  );
  return Promise.all(updates).then(() => repo.read());
}

describe('createQueue', () => {
  it('runs tasks one at a time, in order', async () => {
    const queue = createQueue();
    const events: string[] = [];
    const task = (name: string) => async () => {
      events.push(`start ${name}`);
      await new Promise((resolve) => setTimeout(resolve, 1));
      events.push(`end ${name}`);
      return name;
    };

    const results = await Promise.all([queue(task('a')), queue(task('b')), queue(task('c'))]);

    expect(results).toEqual(['a', 'b', 'c']);
    expect(events).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });

  it('keeps going after a task fails', async () => {
    const queue = createQueue();
    const failing = queue(() => Promise.reject(new Error('boom')));
    const next = queue(() => Promise.resolve('still runs'));

    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('still runs');
  });

  it('prevents the lost updates that unqueued read-modify-writes suffer', async () => {
    // Without the queue every update reads the same starting value, so most of
    // the increments are lost; this is what the queue exists to prevent.
    const unqueued: Queue = (task) => task();
    const lost = await incrementConcurrently(unqueued, 20);
    expect(lost.value.count).toBeLessThan(20);

    const kept = await incrementConcurrently(createQueue(), 20);
    expect(kept.value.count).toBe(20);
  });
});
