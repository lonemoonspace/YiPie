import { describe, expect, it, vi } from 'vitest';
import { createModelSwitcher } from '@/features/panel/model-switcher';

interface Pending {
  id: string;
  resolve: () => void;
  reject: (error: unknown) => void;
}

/** A switcher whose `models.choose` calls stay pending until the test answers them. */
function setup() {
  const sent: Pending[] = [];
  const chosen = vi.fn();
  const failed = vi.fn();
  const pick = createModelSwitcher({
    choose: ({ id }) =>
      new Promise<void>((resolve, reject) => {
        sent.push({ id, resolve, reject });
      }),
    chosen,
    failed,
  });
  const ids = () => sent.map((call) => call.id);
  return { pick, sent, ids, chosen, failed };
}

/** Lets every pending promise callback run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createModelSwitcher', () => {
  it('stores a pick, then goes on with it', async () => {
    const { pick, sent, chosen, failed } = setup();

    pick({ id: 'b' });
    await settle();
    sent[0]?.resolve();
    await settle();

    expect(chosen).toHaveBeenCalledOnce();
    expect(failed).not.toHaveBeenCalled();
  });

  it('sends one pick at a time, in the order they were made', async () => {
    const { pick, sent, ids, chosen } = setup();

    pick({ id: 'b' });
    await settle();
    pick({ id: 'c' });
    await settle();
    // `c` waits for `b`, so the background stores them in this order.
    expect(ids()).toEqual(['b']);

    sent[0]?.resolve();
    await settle();
    expect(ids()).toEqual(['b', 'c']);
    // `b` was replaced: its answer starts nothing.
    expect(chosen).not.toHaveBeenCalled();

    sent[1]?.resolve();
    await settle();
    expect(chosen).toHaveBeenCalledOnce();
  });

  it('does not send a pick that a newer one replaced before its turn', async () => {
    const { pick, sent, ids, chosen } = setup();

    pick({ id: 'b' });
    await settle();
    pick({ id: 'c' });
    pick({ id: 'd' });
    await settle();
    sent[0]?.resolve();
    await settle();
    sent[1]?.resolve();
    await settle();

    expect(ids()).toEqual(['b', 'd']);
    expect(chosen).toHaveBeenCalledOnce();
  });

  it('sends only the newest of picks made before the first one went out', async () => {
    const { pick, sent, ids, chosen } = setup();

    pick({ id: 'b' });
    pick({ id: 'c' });
    await settle();
    sent[0]?.resolve();
    await settle();

    expect(ids()).toEqual(['c']);
    expect(chosen).toHaveBeenCalledOnce();
  });

  it('ignores the failure of a pick that a newer one replaced', async () => {
    const { pick, sent, chosen, failed } = setup();

    pick({ id: 'b' });
    await settle();
    pick({ id: 'c' });
    await settle();
    sent[0]?.reject(new Error('b was deleted meanwhile'));
    await settle();
    sent[1]?.resolve();
    await settle();

    expect(failed).not.toHaveBeenCalled();
    expect(chosen).toHaveBeenCalledOnce();
  });

  it('reports the failure of the newest pick, and keeps working after it', async () => {
    const { pick, sent, chosen, failed } = setup();
    const error = new Error('read-only');

    pick({ id: 'b' });
    await settle();
    sent[0]?.reject(error);
    await settle();
    expect(failed).toHaveBeenCalledWith(error);
    expect(chosen).not.toHaveBeenCalled();

    pick({ id: 'c' });
    await settle();
    sent[1]?.resolve();
    await settle();
    expect(chosen).toHaveBeenCalledOnce();
  });
});
