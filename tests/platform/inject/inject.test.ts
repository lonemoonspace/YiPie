import { describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { injectInto, openPanelInTab, type InjectDeps } from '@/platform/inject/inject';

function deps(overrides: Partial<InjectDeps> = {}) {
  return {
    storageIsolated: vi.fn(() => Promise.resolve()),
    injectInto: vi.fn(() => Promise.resolve()),
    markUnavailable: vi.fn(() => Promise.resolve()),
    markAvailable: vi.fn(() => Promise.resolve()),
    ...overrides,
  } satisfies InjectDeps;
}

const page = { id: 7, url: 'https://example.com/article' };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const PAGE_KEY = 'https://example.com/article';

describe('openPanelInTab', () => {
  it('injects into an ordinary page once storage.local is isolated', async () => {
    const d = deps();
    await openPanelInTab(page, undefined, d);
    expect(d.injectInto).toHaveBeenCalledWith(
      7,
      { mode: 'page', selectionText: '' },
      'https://example.com/article',
    );
    expect(d.markUnavailable).not.toHaveBeenCalled();
  });

  it('marks the icon when the script finds no place for the panel, as in an SVG file (#29)', async () => {
    const d = deps({ injectInto: vi.fn(() => Promise.resolve(false)) });
    await openPanelInTab(page, undefined, d);
    expect(d.markUnavailable).toHaveBeenCalledWith(7);
    expect(d.markAvailable).not.toHaveBeenCalled();
  });

  it('clears the mark an earlier failure left on the icon once the page opens (#31)', async () => {
    const d = deps({ injectInto: vi.fn().mockRejectedValueOnce(new Error('no')) });
    await openPanelInTab(page, undefined, d);
    expect(d.markUnavailable).toHaveBeenCalledWith(7);
    expect(d.markAvailable).not.toHaveBeenCalled();

    await openPanelInTab(page, undefined, d);
    expect(d.markAvailable).toHaveBeenCalledWith(7);
  });

  it('passes on a selection trigger, with what the menu reported as selected', async () => {
    const d = deps();
    const trigger = { mode: 'selection' as const, selectionText: '选中的话' };
    await openPanelInTab(page, trigger, d);
    expect(d.injectInto).toHaveBeenCalledWith(7, trigger, 'https://example.com/article');
  });

  it('waits for the isolation gate before injecting', async () => {
    let confirm = () => {};
    const d = deps({ storageIsolated: () => new Promise<void>((resolve) => (confirm = resolve)) });

    const opening = openPanelInTab(page, undefined, d);
    await settle();
    expect(d.injectInto).not.toHaveBeenCalled();

    confirm();
    await opening;
    expect(d.injectInto).toHaveBeenCalledOnce();
  });

  it('injects nothing when the gate fails, and says so on the icon', async () => {
    const d = deps({ storageIsolated: () => Promise.reject(new Error('not supported')) });

    await openPanelInTab(page, undefined, d);

    expect(d.injectInto).not.toHaveBeenCalled();
    expect(d.markUnavailable).toHaveBeenCalledWith(7);
  });

  it('marks pages it may not script without touching them', async () => {
    for (const url of ['chrome://settings', 'https://chromewebstore.google.com/x', undefined]) {
      const d = deps();
      await openPanelInTab({ id: 3, url }, undefined, d);
      expect(d.injectInto).not.toHaveBeenCalled();
      expect(d.markUnavailable).toHaveBeenCalledWith(3);
    }
  });

  it('marks the page when the browser refuses the injection', async () => {
    const d = deps({ injectInto: () => Promise.reject(new Error('Cannot access contents')) });
    await openPanelInTab(page, undefined, d);
    expect(d.markUnavailable).toHaveBeenCalledWith(7);
  });

  it('ignores a tab without an id', async () => {
    const d = deps();
    await openPanelInTab({ url: page.url }, undefined, d);
    expect(d.injectInto).not.toHaveBeenCalled();
    expect(d.markUnavailable).not.toHaveBeenCalled();
  });
});

describe('injectInto (the browser)', () => {
  it('lets one injection into a tab finish before the next writes the slot (#29)', async () => {
    const calls: string[] = [];
    let finishFirst: () => void = () => undefined;
    let call = 0;
    vi.spyOn(browser.scripting, 'executeScript').mockImplementation(((details: {
      func?: unknown;
      args?: [string, { selectionText: string }];
    }) => {
      call += 1;
      const what = details.func === undefined ? 'files' : `slot:${details.args?.[1].selectionText}`;
      calls.push(what);
      // The first injection's script takes a while to run.
      if (call === 2) return new Promise((resolve) => (finishFirst = () => resolve([{}])));
      return Promise.resolve([{}]);
    }) as never);

    const first = injectInto(7, { mode: 'selection', selectionText: 'A' }, PAGE_KEY);
    const second = injectInto(7, { mode: 'selection', selectionText: 'B' }, PAGE_KEY);
    await settle();
    expect(calls).toEqual(['slot:A', 'files']);

    finishFirst();
    await Promise.all([first, second]);
    expect(calls).toEqual(['slot:A', 'files', 'slot:B', 'files']);
  });

  it('says the panel did not open when the script returned false (#29)', async () => {
    vi.spyOn(browser.scripting, 'executeScript').mockResolvedValue([
      { documentId: 'd', frameId: 0, result: false },
    ] as never);

    expect(await injectInto(8, { mode: 'page', selectionText: '' }, PAGE_KEY)).toBe(false);
  });
});
