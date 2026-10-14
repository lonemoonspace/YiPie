import { describe, expect, it } from 'vitest';
import { PANEL_REGISTRY_KEY, PANEL_REGISTRY_LIMIT } from '@/contract/panel-registry';
import { createPanelRegistry } from '@/platform/inject/registry';
import { createQueue } from '@/platform/storage';
import { createMemoryStore } from '../../helpers/memory-store';

function setup() {
  const store = createMemoryStore();
  let count = 0;
  let clock = 1000;
  const registry = createPanelRegistry(
    store,
    createQueue(),
    () => `nonce-${++count}`,
    () => clock++,
  );
  return { store, registry };
}

describe('panel registry', () => {
  it('lets the document that presents the current nonce attach, once', async () => {
    const { registry } = setup();
    const nonce = await registry.issue(7);

    expect(await registry.attach(7, nonce, 'doc-a')).toBe(true);
    expect(await registry.isAttached(7, 'doc-a')).toBe(true);

    // Presenting it again from the same document is fine; from another is not.
    expect(await registry.attach(7, nonce, 'doc-a')).toBe(true);
    expect(await registry.attach(7, nonce, 'doc-b')).toBe(false);
    expect(await registry.isAttached(7, 'doc-b')).toBe(false);
  });

  it('refuses a wrong nonce, another tab, and a tab with no nonce', async () => {
    const { registry } = setup();
    const nonce = await registry.issue(7);

    expect(await registry.attach(7, 'guess', 'doc-a')).toBe(false);
    expect(await registry.attach(8, nonce, 'doc-a')).toBe(false);
    expect(await registry.attach(9, 'anything', 'doc-a')).toBe(false);
    expect(await registry.isAttached(7, 'doc-a')).toBe(false);
  });

  it('retires the previous nonce when a new frame is mounted', async () => {
    const { registry } = setup();
    const first = await registry.issue(7);
    await registry.attach(7, first, 'doc-a');

    const second = await registry.issue(7);

    expect(await registry.isAttached(7, 'doc-a')).toBe(false);
    expect(await registry.attach(7, first, 'doc-b')).toBe(false);
    expect(await registry.attach(7, second, 'doc-b')).toBe(true);
  });

  it('lives in session storage, inside an envelope', async () => {
    const { registry, store } = setup();
    await registry.issue(7);

    expect(PANEL_REGISTRY_KEY.startsWith('session:')).toBe(true);
    expect(store.dump()[PANEL_REGISTRY_KEY]).toEqual({
      version: 1,
      data: { '7': { nonce: 'nonce-1', issuedAt: 1000, attachedDocument: null } },
    });
  });

  it('keeps entries for tabs that issue at the same time', async () => {
    const { registry } = setup();
    const [a, b] = await Promise.all([registry.issue(1), registry.issue(2)]);

    expect(await registry.attach(1, a, 'doc-1')).toBe(true);
    expect(await registry.attach(2, b, 'doc-2')).toBe(true);
  });

  it('forgets the oldest tabs beyond the limit', async () => {
    const { registry, store } = setup();
    for (let tab = 0; tab <= PANEL_REGISTRY_LIMIT; tab++) await registry.issue(tab);

    const stored = store.dump()[PANEL_REGISTRY_KEY] as { data: Record<string, unknown> };
    expect(Object.keys(stored.data)).toHaveLength(PANEL_REGISTRY_LIMIT);
    expect(stored.data).not.toHaveProperty('0');
    expect(stored.data).toHaveProperty(String(PANEL_REGISTRY_LIMIT));
  });
});
