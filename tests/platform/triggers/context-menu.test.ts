import { describe, expect, it, vi } from 'vitest';
import { SUMMARIZE_MENU_ITEM } from '@/contract/commands';
import type { TabLike } from '@/platform/inject/inject';
import { onContextMenu, type ContextMenuApi } from '@/platform/triggers/context-menu';

/** A fake menu API whose events the test fires by hand. */
function fakeApi() {
  let installed: (() => void) | undefined;
  let clicked: ((menuItemId: string | number, tab: TabLike | undefined) => void) | undefined;
  const calls: string[] = [];
  const api: ContextMenuApi = {
    onInstalled: (listener) => (installed = listener),
    removeAll: () => {
      calls.push('removeAll');
      return Promise.resolve();
    },
    create: (item) => calls.push(`create ${item.id} "${item.title}" ${item.contexts.join(',')}`),
    onClicked: (listener) => (clicked = listener),
  };
  return {
    api,
    calls,
    install: () => installed?.(),
    click: (id: string | number, tab?: TabLike) => clicked?.(id, tab),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the context menu', () => {
  it('adds 「总结此页」 for pages on install or update, clearing what was there first', async () => {
    const menu = fakeApi();
    onContextMenu(vi.fn(), menu.api);
    expect(menu.calls).toEqual([]);

    menu.install();
    await settle();

    expect(menu.calls).toEqual([
      'removeAll',
      `create ${SUMMARIZE_MENU_ITEM} "用一瞥总结此页" page`,
    ]);
  });

  it('opens the panel in the tab it was clicked in', () => {
    const menu = fakeApi();
    const open = vi.fn();
    onContextMenu(open, menu.api);

    menu.click(SUMMARIZE_MENU_ITEM, { id: 7, url: 'https://example.com/' });

    expect(open).toHaveBeenCalledWith({ id: 7, url: 'https://example.com/' });
  });

  it('ignores other items and clicks without a tab', () => {
    const menu = fakeApi();
    const open = vi.fn();
    onContextMenu(open, menu.api);

    menu.click('something-else', { id: 7 });
    menu.click(SUMMARIZE_MENU_ITEM);

    expect(open).not.toHaveBeenCalled();
  });
});
