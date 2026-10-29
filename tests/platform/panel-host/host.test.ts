// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { PANEL_ATTACH_FAILED } from '@/contract/rpc-wire';
import { openPanelHost } from '@/platform/panel-host/host';

/*
 * The host in a jsdom page. jsdom has no Navigation API and no constructable
 * style sheets; stand-ins do nothing, which is all the host needs of them here.
 */
beforeEach(() => {
  vi.stubGlobal('navigation', new EventTarget());
  if (!('replaceSync' in CSSStyleSheet.prototype)) {
    Object.defineProperty(CSSStyleSheet.prototype, 'replaceSync', { value: () => undefined });
  }
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  // The extension "goes away" for a moment: the open host closes itself, as
  // it does after an update (orphan.ts), and stops watching the page.
  const runtime = browser.runtime as { id?: string };
  const id = runtime.id;
  runtime.id = undefined;
  window.dispatchEvent(new Event('focus'));
  runtime.id = id;
  // A fresh host for each test: the guard lives on the global object.
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('yipie.panel-host')];
  vi.unstubAllGlobals();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Answers `content.hello` with each reply in turn, the last one from then on. */
function hello(...replies: ('ok' | 'refused')[]) {
  const spy = vi.spyOn(browser.runtime, 'sendMessage');
  replies.forEach((reply, index) => {
    const value =
      reply === 'ok'
        ? {
            ok: true,
            value: {
              nonce: `n${index}`,
              pageKey: location.href,
              theme: 'auto',
              locale: 'zh-Hans',
            },
          }
        : { ok: false, error: { code: 'internal', message: 'no' } };
    if (index === replies.length - 1) spy.mockResolvedValue(value as never);
    else spy.mockResolvedValueOnce(value as never);
  });
  return spy;
}

/**
 * The frames the host has mounted, in order. Its shadow root is closed, so
 * the test keeps the roots as they are attached and watches them.
 */
let mounted: HTMLIFrameElement[] = [];
const frames = () => mounted;
beforeEach(() => {
  mounted = [];
  const attach = Object.getOwnPropertyDescriptor(Element.prototype, 'attachShadow')?.value as (
    this: Element,
    init: ShadowRootInit,
  ) => ShadowRoot;
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (
    this: Element,
    init: ShadowRootInit,
  ) {
    const root = attach.call(this, init);
    new MutationObserver(() => {
      for (const frame of root.querySelectorAll('iframe')) {
        if (!mounted.includes(frame)) mounted.push(frame);
      }
    }).observe(root, { childList: true, subtree: true });
    return root;
  });
});

describe('panel host', () => {
  it('mounts again on the next trigger after content.hello failed (#22)', async () => {
    const send = hello('refused', 'ok');
    openPanelHost('page');
    await settle();
    expect(send).toHaveBeenCalledTimes(1);

    openPanelHost('page');
    await settle();

    expect(send).toHaveBeenCalledTimes(2);
    expect(frames()).toHaveLength(1);
  });

  it('leaves an attached panel as it is when the page is asked for again', async () => {
    const send = hello('ok');
    openPanelHost('page');
    await settle();
    openPanelHost('page');
    await settle();

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('mounts again on the next trigger after the panel could not attach (#22)', async () => {
    const send = hello('ok');
    openPanelHost('page');
    await settle();
    const [frame] = frames();
    expect(frame).toBeDefined();

    // The panel page tells the host; a message from anyone else counts for nothing.
    window.dispatchEvent(
      new MessageEvent('message', { data: PANEL_ATTACH_FAILED, source: window }),
    );
    openPanelHost('page');
    await settle();
    expect(send).toHaveBeenCalledTimes(1);

    window.dispatchEvent(
      new MessageEvent('message', { data: PANEL_ATTACH_FAILED, source: frame?.contentWindow }),
    );
    openPanelHost('page');
    await settle();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('closes a selection panel when the page changed since the trigger (#29)', async () => {
    hello('ok');
    openPanelHost('selection', 'https://example.com/before');
    await settle();

    expect(frames()).toHaveLength(0);
  });
});
