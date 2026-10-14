import { describe, expect, it, vi } from 'vitest';
import {
  RPC_CHANNEL,
  RPC_METHODS,
  type GeneralSettingsView,
  type MethodDefinition,
  type ModelConfigsView,
  type PanelModelsView,
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

const panelModels: PanelModelsView = { choices: [{ id: 'a', name: 'A' }], current: null };

const models: ModelConfigsView = {
  items: [],
  defaultId: null,
  unrecognized: 0,
  status: 'ok',
  readOnly: false,
  quarantined: false,
  defaultFellBack: false,
  defaultUnreadable: false,
};

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
    'models.update': vi.fn(() => Promise.resolve(models)),
    'models.remove': vi.fn(() => Promise.resolve(models)),
    'models.move': vi.fn(() => Promise.resolve(models)),
    'models.setDefault': vi.fn(() => Promise.resolve(models)),
    'models.current': vi.fn(() => Promise.resolve(panelModels)),
    'models.choose': vi.fn(() => Promise.resolve(panelModels)),
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

  it('logs where a refused call came from without the rest of the URL', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { dispatch } = setup();
    const page = { ...CONTENT, url: 'https://example.com/reset?token=page-secret#also-secret' };

    await dispatch(request('settings.get'), page);

    const logged = warn.mock.calls.flat().map(String).join(' ');
    expect(logged).toContain('https://example.com');
    expect(logged).not.toContain('page-secret');
    expect(logged).not.toContain('also-secret');
    warn.mockRestore();
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
  it('lists every configuration, keys included, to the settings page only', async () => {
    const { dispatch, handlers } = setup();

    expect(await dispatch(request('models.list'), OPTIONS)).toEqual({ ok: true, value: models });
    for (const sender of [PANEL, STRAY_PANEL, CONTENT]) {
      expect(await dispatch(request('models.list'), sender)).toMatchObject({
        ok: false,
        error: { code: 'forbidden' },
      });
    }
    expect(handlers['models.list']).toHaveBeenCalledOnce();
  });

  it('gives the attached panel the menu and the model in use, and no one else', async () => {
    const { dispatch, handlers } = setup();

    expect(await dispatch(request('models.current'), PANEL)).toEqual({
      ok: true,
      value: panelModels,
    });
    for (const sender of [OPTIONS, STRAY_PANEL, CONTENT]) {
      expect(await dispatch(request('models.current'), sender)).toMatchObject({
        ok: false,
        error: { code: 'forbidden' },
      });
    }
    expect(handlers['models.current']).toHaveBeenCalledOnce();
  });

  it('accepts changes only from the settings page', async () => {
    const { dispatch, handlers } = setup();
    const add = request('models.add', { baseURL: 'http://localhost:11434/v1', model: 'm' });

    expect(await dispatch(add, PANEL)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await dispatch(add, CONTENT)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(handlers['models.add']).not.toHaveBeenCalled();

    expect(await dispatch(add, OPTIONS)).toEqual({ ok: true, value: models });
  });

  it.each([
    ['models.update', { id: 'a', patch: { name: 'n' } }],
    ['models.remove', { id: 'a' }],
    ['models.move', { id: 'a', direction: 'up' }],
    ['models.setDefault', { id: 'a' }],
  ] as const)('accepts %s only from the settings page', async (method, input) => {
    const { dispatch, handlers } = setup();

    for (const sender of [PANEL, STRAY_PANEL, CONTENT]) {
      expect(await dispatch(request(method, input), sender)).toMatchObject({
        ok: false,
        error: { code: 'forbidden' },
      });
    }
    expect(handlers[method]).not.toHaveBeenCalled();
    expect(await dispatch(request(method, input), OPTIONS)).toEqual({ ok: true, value: models });
  });

  it('lets the attached panel choose the default model, as its one change', async () => {
    const { dispatch, handlers } = setup();
    const choose = request('models.choose', { id: 'a' });

    expect(await dispatch(choose, PANEL)).toEqual({ ok: true, value: panelModels });
    for (const sender of [OPTIONS, STRAY_PANEL, CONTENT]) {
      expect(await dispatch(choose, sender)).toMatchObject({
        ok: false,
        error: { code: 'forbidden' },
      });
    }
    expect(handlers['models.choose']).toHaveBeenCalledOnce();
    expect(await dispatch(request('models.choose', { id: 'a', items: [] }), PANEL)).toMatchObject({
      ok: false,
      error: { code: 'bad-request' },
    });
  });

  it('drops anything else a handler adds to the panel answer, such as every configuration', async () => {
    const leaky = { ...panelModels, items: [{ id: 'b', apiKey: 'sk-other-model' }] };
    const { dispatch } = setup({ 'models.current': () => Promise.resolve(leaky) });

    const reply = await dispatch(request('models.current'), PANEL);

    expect(reply).toEqual({ ok: true, value: panelModels });
    expect(JSON.stringify(reply)).not.toContain('sk-other-model');
  });

  it('drops fields the model in use carries beyond what a request needs', async () => {
    const inUse = {
      id: 'a',
      name: '',
      baseURL: 'https://api.example.com/v1',
      apiKey: 'sk-a',
      model: 'm',
      headers: {},
      extraBody: {},
      contextWindow: null,
      streamUsage: true,
    };
    const { dispatch } = setup({
      'models.current': () =>
        Promise.resolve({ choices: [], current: { ...inUse, futureToken: 'tok-unknown' } }),
    });

    const reply = await dispatch(request('models.current'), PANEL);

    expect(reply).toEqual({ ok: true, value: { choices: [], current: inUse } });
    expect(JSON.stringify(reply)).not.toContain('tok-unknown');
  });

  it.each([
    ['models.move', { id: 'a', direction: 'top' }],
    ['models.remove', { id: '' }],
    ['models.update', { id: 'a', patch: { id: 'b' } }],
    ['models.setDefault', { id: 'a', items: [] }],
  ] as const)('rejects malformed %s input without running the handler', async (method, input) => {
    const { dispatch, handlers } = setup();

    expect(await dispatch(request(method, input), OPTIONS)).toMatchObject({
      ok: false,
      error: { code: 'bad-request' },
    });
    expect(handlers[method]).not.toHaveBeenCalled();
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

describe('RPC dispatcher: prompts', () => {
  const prompts = { ...models, items: [] };

  it('lets the settings page and the attached panel read the prompts, and nothing else', async () => {
    const { dispatch } = setup({ 'prompts.list': () => Promise.resolve(prompts) });

    expect(await dispatch(request('prompts.list'), OPTIONS)).toEqual({ ok: true, value: prompts });
    expect(await dispatch(request('prompts.list'), PANEL)).toEqual({ ok: true, value: prompts });
    for (const sender of [STRAY_PANEL, CONTENT]) {
      expect(await dispatch(request('prompts.list'), sender)).toMatchObject({
        ok: false,
        error: { code: 'forbidden' },
      });
    }
  });

  it.each([
    ['prompts.add', { name: 'n', user: '{{content}}' }],
    ['prompts.update', { id: 'p', patch: { name: 'n' } }],
    ['prompts.remove', { id: 'p' }],
    ['prompts.move', { id: 'p', direction: 'down' }],
    // Unlike the model, the panel may not change the default prompt.
    ['prompts.setDefault', { id: 'p' }],
  ] as const)('accepts %s only from the settings page', async (method, input) => {
    const handler = vi.fn(() => Promise.resolve(prompts));
    const { dispatch } = setup({ [method]: handler });

    for (const sender of [PANEL, STRAY_PANEL, CONTENT]) {
      expect(await dispatch(request(method, input), sender)).toMatchObject({
        ok: false,
        error: { code: 'forbidden' },
      });
    }
    expect(handler).not.toHaveBeenCalled();
    expect(await dispatch(request(method, input), OPTIONS)).toEqual({ ok: true, value: prompts });
  });

  it('rejects a prompt without a user template', async () => {
    const { dispatch, handlers } = setup();

    expect(
      await dispatch(request('prompts.add', { name: 'n', user: '   ' }), OPTIONS),
    ).toMatchObject({ ok: false, error: { code: 'bad-request' } });
    expect(handlers['prompts.add']).not.toHaveBeenCalled();
  });
});

describe('RPC dispatcher: backups', () => {
  const backups = { backups: [] };

  it.each([
    ['backups.list', {}],
    ['backups.remove', { key: 'local:model-configs', at: '2026-10-14T00:00:00.000Z' }],
  ] as const)('serves %s to the settings page only: backups hold keys', async (method, input) => {
    const handler = vi.fn(() => Promise.resolve(backups));
    const { dispatch } = setup({ [method]: handler });

    for (const sender of [PANEL, STRAY_PANEL, CONTENT]) {
      expect(await dispatch(request(method, input), sender)).toMatchObject({
        ok: false,
        error: { code: 'forbidden' },
      });
    }
    expect(handler).not.toHaveBeenCalled();
    expect(await dispatch(request(method, input), OPTIONS)).toEqual({ ok: true, value: backups });
  });

  it('will not delete the backup of a key that is not a user record', async () => {
    const { dispatch, handlers } = setup();

    const reply = await dispatch(
      request('backups.remove', { key: 'session:panel-registry', at: 'unknown' }),
      OPTIONS,
    );

    expect(reply).toMatchObject({ ok: false, error: { code: 'bad-request' } });
    expect(handlers['backups.remove']).not.toHaveBeenCalled();
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
    ['models.current', {}],
    ['models.choose', { id: 'a' }],
    ['prompts.list', {}],
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

    await dispatch(request('models.current'), PANEL);
    await dispatch(request('models.current'), { ...PANEL, tab: { id: 2 } });

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
      expect(await dispatch(request('models.current'), sender)).toMatchObject({
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

    expect(await dispatch(request('models.current'), PANEL)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(handlers['models.current']).not.toHaveBeenCalled();
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
