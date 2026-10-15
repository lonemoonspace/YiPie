import { afterEach, describe, expect, it, vi } from 'vitest';
import { SUMMARIZE_MENU_ITEM, SUMMARIZE_SELECTION_MENU_ITEM } from '@/contract/commands';
import type { TabLike } from '@/platform/inject/inject';
import { setLocale } from '@/domain/i18n/background';
import {
  onContextMenu,
  retitleContextMenu,
  type ContextMenuApi,
} from '@/platform/triggers/context-menu';

/** A fake menu API whose events the test fires by hand. */
function fakeApi() {
  let installed: (() => void) | undefined;
  let clicked:
    | ((
        info: { menuItemId: string | number; selectionText?: string },
        tab: TabLike | undefined,
      ) => void)
    | undefined;
  const calls: string[] = [];
  const api: ContextMenuApi = {
    onInstalled: (listener) => (installed = listener),
    removeAll: () => {
      calls.push('removeAll');
      return Promise.resolve();
    },
    create: (item) => calls.push(`create ${item.id} "${item.title}" ${item.contexts.join(',')}`),
    update: (id, { title }) => {
      calls.push(`update ${id} "${title}"`);
      return Promise.resolve();
    },
    onClicked: (listener) => (clicked = listener),
  };
  return {
    api,
    calls,
    install: () => installed?.(),
    click: (id: string | number, tab?: TabLike, selectionText?: string) =>
      clicked?.({ menuItemId: id, selectionText }, tab),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the context menu', () => {
  afterEach(() => setLocale('zh-Hans'));

  it('adds 「总结此页」 for pages and 「总结选中内容」 for selections on install or update, clearing what was there first', async () => {
    const menu = fakeApi();
    onContextMenu(vi.fn(), menu.api);
    expect(menu.calls).toEqual([]);

    menu.install();
    await settle();

    expect(menu.calls).toEqual([
      'removeAll',
      `create ${SUMMARIZE_MENU_ITEM} "用一瞥总结此页" page`,
      `create ${SUMMARIZE_SELECTION_MENU_ITEM} "用一瞥总结选中内容" selection`,
    ]);
  });

  it('opens the panel in the tab it was clicked in', () => {
    const menu = fakeApi();
    const open = vi.fn();
    onContextMenu(open, menu.api);

    menu.click(SUMMARIZE_MENU_ITEM, { id: 7, url: 'https://example.com/' });

    expect(open).toHaveBeenCalledWith(
      { id: 7, url: 'https://example.com/' },
      { mode: 'page', selectionText: '' },
    );
  });

  it('summarizes the selection from its own item, with the text the menu reported', () => {
    const menu = fakeApi();
    const open = vi.fn();
    onContextMenu(open, menu.api);

    menu.click(SUMMARIZE_SELECTION_MENU_ITEM, { id: 7 }, '选中的话');

    expect(open).toHaveBeenCalledWith({ id: 7 }, { mode: 'selection', selectionText: '选中的话' });
  });

  it('ignores other items and clicks without a tab', () => {
    const menu = fakeApi();
    const open = vi.fn();
    onContextMenu(open, menu.api);

    menu.click('something-else', { id: 7 });
    menu.click(SUMMARIZE_MENU_ITEM);

    expect(open).not.toHaveBeenCalled();
  });

  it('waits for the interface language before creating the items', async () => {
    const menu = fakeApi();
    let languageKnown = () => {};
    const ready = new Promise<void>((resolve) => (languageKnown = resolve));
    onContextMenu(vi.fn(), menu.api, () => ready);

    menu.install();
    await settle();
    expect(menu.calls).toEqual(['removeAll']);

    setLocale('en');
    languageKnown();
    await settle();
    expect(menu.calls).toEqual([
      'removeAll',
      `create ${SUMMARIZE_MENU_ITEM} "Summarize this page with YiPie" page`,
      `create ${SUMMARIZE_SELECTION_MENU_ITEM} "Summarize the selection with YiPie" selection`,
    ]);
  });

  it('retitles the items in the language now in use', async () => {
    const menu = fakeApi();
    setLocale('en');

    await retitleContextMenu(menu.api);

    expect(menu.calls).toEqual([
      `update ${SUMMARIZE_MENU_ITEM} "Summarize this page with YiPie"`,
      `update ${SUMMARIZE_SELECTION_MENU_ITEM} "Summarize the selection with YiPie"`,
    ]);
  });
});
