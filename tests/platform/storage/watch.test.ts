import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { onStoredChange } from '@/platform/storage/watch';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('onStoredChange', () => {
  it('signals a change to a watched key, in its own area only', async () => {
    const listener = vi.fn();
    onStoredChange(['local:quarantine:model-configs'], listener);

    await fakeBrowser.storage.session.set({ 'quarantine:model-configs': 1 });
    await fakeBrowser.storage.local.set({ 'model-configs': 1 });
    expect(listener).not.toHaveBeenCalled();

    await fakeBrowser.storage.local.set({ 'quarantine:model-configs': 1 });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('stops once unsubscribed', async () => {
    const listener = vi.fn();
    const stop = onStoredChange(['local:selection'], listener);

    stop();
    await fakeBrowser.storage.local.set({ selection: 1 });

    expect(listener).not.toHaveBeenCalled();
  });
});
