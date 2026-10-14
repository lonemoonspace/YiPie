import { describe, expect, it, vi } from 'vitest';
import {
  RPC_CHANNEL,
  RPC_METHODS,
  type GeneralSettingsView,
  type MethodDefinition,
  type ModelConfigsView,
} from '@/contract/rpc';
import { RpcRefusal } from '@/platform/rpc/errors';
import { createDispatcher, type RpcHandlers } from '@/platform/rpc/server';
import { NotFoundError } from '@/platform/settings/errors';
import { ReadOnlyRecordError } from '@/platform/storage';
import { stubHandlers } from '../../helpers/rpc-handlers';

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
const OPTIONS = { id: EXTENSION_ID, url: `chrome-extension://${EXTENSION_ID}/options.html` };
/** The panel attached in tab 1 (see `attachedInTab1`). */
const PANEL = {
  id: EXTENSION_ID,
  url: `chrome-extension://${EXTENSION_ID}/panel.html#n=1`,
  tab: { id: 1 },
  frameId: 3,
  documentId: 'DOC',
};
/** Another panel document in the same tab, which never attached: e.g. one a page embedded. */
const STRAY_PANEL = { ...PANEL, documentId: 'STRAY' };
const CONTENT = { id: EXTENSION_ID, url: 'https://example.com/', tab: { id: 1 }, frameId: 0 };

const attachedInTab1 = (tabId: number, documentId: string) =>
  Promise.resolve(tabId === 1 && documentId === 'DOC');

const view: GeneralSettingsView = {
  settings: { theme: 'dark', logLevel: 'info' },
  status: 'ok',
  readOnly: false,
  quarantined: false,
};

const models: ModelConfigsView = { configs: [], status: 'ok', readOnly: false, quarantined: false };

function setup(
  overrides: Partial<RpcHandlers> = {},
  storageIsolated: () => Promise<void> = () => Promise.resolve(),
  panelAttached: (tabId: number, documentId: string) => Promise<boolean> = attachedInTab1,
) {
  const handlers = stubHandlers({
    'settings.get': vi.fn(() => Promise.resolve(view)),
    'settings.patch': vi.fn(() => Promise.resolve(view)),
    'models.list': vi.fn(() => Promise.resolve(models)),
    'models.add': vi.fn(() => Promise.resolve(models)),
    ...overrides,
  });
  return {
    handlers,
    dispatch: createDispatcher(handlers, EXTENSION_ID, { storageIsolated, panelAttached }),
  };
}

const request = (method: string, input: unknown = {}) => ({ channel: RPC_CHANNEL, method, input });

/** Lets every pending promise callback run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('RPC dispatcher', () => {
  it('runs an allowed call and returns the validated output', async () => {
    const { dispatch, handlers } = setup();

    const reply = await dispatch(request('settings.patch', { theme: 'dark' }), OPTIONS);

    expect(reply).toEqual({ ok: true, value: view });
    expect(handlers['settings.patch']).toHaveBeenCalledWith(
      { theme: 'dark' },
      { caller: 'options', tabId: undefined, documentId: undefined },
    );
  });

  it('refuses a caller kind the method does not list, without running the handler', async () => {
    const { dispatch, handlers } = setup();

    const reply = await dispatch(request('settings.patch', { theme: 'dark' }), CONTENT);

    expect(reply).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(handlers['settings.patch']).not.toHaveBeenCalled();
  });

  it('refuses senders it cannot classify', async () => {
    const { dispatch } = setup();
    const foreign = { id: 'another-extension', url: 'chrome-extension://other/options.html' };

    expect(await dispatch(request('settings.get'), foreign)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });

  it.each(['settings.delete', 'toString', '__proto__', 'constructor'])(
    'reports %s as an unknown method',
    async (method) => {
      const { dispatch } = setup();
      expect(await dispatch(request(method), OPTIONS)).toMatchObject({
        ok: false,
        error: { code: 'unknown-method' },
      });
    },
  );

  it.each([
    ['an out-of-range value', { theme: 'neon' }],
    ['an unknown field', { theme: 'dark', apiKey: 'sk-…' }],
    ['a non-object', 'dark'],
  ])('rejects input with %s', async (_label, input) => {
    const { dispatch, handlers } = setup();

    expect(await dispatch(request('settings.patch', input), OPTIONS)).toMatchObject({
      ok: false,
      error: { code: 'bad-request' },
    });
    expect(handlers['settings.patch']).not.toHaveBeenCalled();
  });

  it('rejects a malformed request', async () => {
    const { dispatch } = setup();
    expect(await dispatch({ method: 'settings.get' }, OPTIONS)).toMatchObject({
      ok: false,
      error: { code: 'bad-request' },
    });
  });

  it('maps a read-only record to a read-only error', async () => {
    const { dispatch } = setup({
      'settings.patch': () => Promise.reject(new ReadOnlyRecordError('local:general-settings', 2)),
    });

    expect(await dispatch(request('settings.patch', { theme: 'light' }), OPTIONS)).toMatchObject({
      ok: false,
      error: { code: 'read-only' },
    });
  });

  it('reports handler failures and contract-breaking output as internal errors', async () => {
    const throwing = setup({ 'settings.get': () => Promise.reject(new Error('disk on fire')) });
    expect(await throwing.dispatch(request('settings.get'), OPTIONS)).toEqual({
      ok: false,
      error: { code: 'internal', message: 'disk on fire' },
    });

    const lying = setup({
      'settings.get': () => Promise.resolve({ ...view, status: 'weird' } as never),
    });
    expect(await lying.dispatch(request('settings.get'), OPTIONS)).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    });
  });
});

describe('RPC dispatcher before storage.local is isolated', () => {
  it('holds a request that arrives during start-up until isolation is confirmed', async () => {
    let confirm = () => {};
    const isolation = new Promise<void>((resolve) => (confirm = resolve));
    const { dispatch, handlers } = setup({}, () => isolation);

    const reply = dispatch(request('settings.patch', { theme: 'dark' }), OPTIONS);
    await settle();
    expect(handlers['settings.patch']).not.toHaveBeenCalled();

    confirm();
    expect(await reply).toEqual({ ok: true, value: view });
    expect(handlers['settings.patch']).toHaveBeenCalledOnce();
  });

  it('refuses every call while isolation fails, without running a handler', async () => {
    const { dispatch, handlers } = setup({}, () =>
      Promise.reject(new Error('setAccessLevel is not supported')),
    );

    for (const call of [request('settings.get'), request('settings.patch', { theme: 'dark' })]) {
      expect(await dispatch(call, OPTIONS)).toEqual({
        ok: false,
        error: {
          code: 'storage-not-isolated',
          message: expect.stringContaining('setAccessLevel is not supported') as string,
        },
      });
    }
    expect(handlers['settings.get']).not.toHaveBeenCalled();
    expect(handlers['settings.patch']).not.toHaveBeenCalled();
  });

  it('serves again once a later attempt succeeds', async () => {
    const storageIsolated = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('not now'))
      .mockResolvedValue(undefined);
    const { dispatch } = setup({}, storageIsolated);

    expect(await dispatch(request('settings.get'), OPTIONS)).toMatchObject({
      ok: false,
      error: { code: 'storage-not-isolated' },
    });
    expect(await dispatch(request('settings.get'), OPTIONS)).toEqual({ ok: true, value: view });
  });

  it('still answers malformed and forbidden calls without waiting', async () => {
    const { dispatch } = setup({}, () => new Promise<void>(() => {}));

    expect(await dispatch(request('settings.get'), CONTENT)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(await dispatch({ method: 'settings.get' }, OPTIONS)).toMatchObject({
      ok: false,
      error: { code: 'bad-request' },
    });
  });
});

describe('RPC dispatcher: model configurations', () => {
  it('lets the settings page and the attached panel list models, and nothing else', async () => {
    const { dispatch } = setup();

    expect(await dispatch(request('models.list'), OPTIONS)).toEqual({ ok: true, value: models });
    expect(await dispatch(request('models.list'), PANEL)).toEqual({ ok: true, value: models });
    for (const sender of [STRAY_PANEL, CONTENT]) {
      expect(await dispatch(request('models.list'), sender)).toMatchObject({
        ok: false,
        error: { code: 'forbidden' },
      });
    }
  });

  it('accepts changes only from the settings page', async () => {
    const { dispatch, handlers } = setup();
    const add = request('models.add', { baseURL: 'http://localhost:11434/v1', model: 'm' });

    expect(await dispatch(add, PANEL)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await dispatch(add, CONTENT)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(handlers['models.add']).not.toHaveBeenCalled();

    expect(await dispatch(add, OPTIONS)).toEqual({ ok: true, value: models });
  });

  it('rejects a configuration whose base URL is not http(s)', async () => {
    const { dispatch, handlers } = setup();

    const reply = await dispatch(
      request('models.add', { baseURL: 'javascript:alert(1)', model: 'm' }),
      OPTIONS,
    );

    expect(reply).toMatchObject({ ok: false, error: { code: 'bad-request' } });
    expect(handlers['models.add']).not.toHaveBeenCalled();
  });

  it('maps an unknown id to not-found', async () => {
    const { dispatch } = setup({
      'models.update': () => Promise.reject(new NotFoundError('model configuration', 'x')),
    });

    expect(
      await dispatch(request('models.update', { id: 'x', patch: { model: 'y' } }), OPTIONS),
    ).toMatchObject({ ok: false, error: { code: 'not-found' } });
  });
});

describe('RPC dispatcher: panel handshake', () => {
  it('lets only the content script ask for a nonce', async () => {
    const { dispatch } = setup({ 'content.hello': () => Promise.resolve({ nonce: 'n' }) });

    expect(await dispatch(request('content.hello'), CONTENT)).toEqual({
      ok: true,
      value: { nonce: 'n' },
    });
    for (const sender of [PANEL, OPTIONS]) {
      expect(await dispatch(request('content.hello'), sender)).toMatchObject({
        ok: false,
        error: { code: 'forbidden' },
      });
    }
  });

  it('lets only a panel attach, before it is attached, and passes its tab and document', async () => {
    const attach = vi.fn(() => Promise.resolve({ tabId: 1 }));
    const { dispatch } = setup({ 'panel.attach': attach });

    expect(await dispatch(request('panel.attach', { nonce: 'n' }), STRAY_PANEL)).toEqual({
      ok: true,
      value: { tabId: 1 },
    });
    expect(attach).toHaveBeenCalledWith(
      { nonce: 'n' },
      { caller: 'panel', tabId: 1, documentId: 'STRAY' },
    );
    expect(await dispatch(request('panel.attach', { nonce: 'n' }), CONTENT)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });

  it('turns a handler refusal into its code', async () => {
    const { dispatch } = setup({
      'panel.attach': () => Promise.reject(new RpcRefusal('forbidden', 'not ours')),
    });

    expect(await dispatch(request('panel.attach', { nonce: 'n' }), PANEL)).toEqual({
      ok: false,
      error: { code: 'forbidden', message: 'not ours' },
    });
  });
});

describe('RPC dispatcher: a panel is served only once attached', () => {
  const PANEL_METHODS = [
    ['models.list', {}],
    ['page.getContext', {}],
  ] as const;

  it.each(PANEL_METHODS)(
    'refuses %s to a panel document that is not attached, without running the handler',
    async (method, input) => {
      const { dispatch, handlers } = setup();

      expect(await dispatch(request(method, input), STRAY_PANEL)).toMatchObject({
        ok: false,
        error: { code: 'forbidden' },
      });
      expect(handlers[method]).not.toHaveBeenCalled();
    },
  );

  it('asks the registry about the sending document in its own tab', async () => {
    const panelAttached = vi.fn(attachedInTab1);
    const { dispatch } = setup({}, undefined, panelAttached);

    await dispatch(request('models.list'), PANEL);
    await dispatch(request('models.list'), { ...PANEL, tab: { id: 2 } });

    expect(panelAttached.mock.calls).toEqual([
      [1, 'DOC'],
      [2, 'DOC'],
    ]);
  });

  it('refuses a panel without a tab or a document id, without asking the registry', async () => {
    const panelAttached = vi.fn(() => Promise.resolve(true));
    const { dispatch } = setup({}, undefined, panelAttached);
    const { id, url, tab, frameId, documentId } = PANEL;
    const withoutDocument = { id, url, tab, frameId };
    const withoutTab = { id, url, frameId, documentId };

    for (const sender of [withoutDocument, withoutTab]) {
      expect(await dispatch(request('models.list'), sender)).toMatchObject({
        ok: false,
        error: { code: 'forbidden' },
      });
    }
    expect(panelAttached).not.toHaveBeenCalled();
  });

  it('fails closed when the registry cannot be read', async () => {
    const { dispatch, handlers } = setup({}, undefined, () =>
      Promise.reject(new Error('session storage unavailable')),
    );

    expect(await dispatch(request('models.list'), PANEL)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(handlers['models.list']).not.toHaveBeenCalled();
  });

  it('does not consult the registry for other callers', async () => {
    const panelAttached = vi.fn(() => Promise.resolve(false));
    const { dispatch } = setup({}, undefined, panelAttached);

    expect(await dispatch(request('models.list'), OPTIONS)).toEqual({ ok: true, value: models });
    expect(panelAttached).not.toHaveBeenCalled();
  });

  it('marks only panel.attach as callable before attaching', () => {
    const early = Object.entries(RPC_METHODS)
      .filter(([, definition]) => (definition as MethodDefinition).beforeAttach === true)
      .map(([method]) => method);
    expect(early).toEqual(['panel.attach']);
  });
});
