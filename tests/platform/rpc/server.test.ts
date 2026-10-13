import { describe, expect, it, vi } from 'vitest';
import { RPC_CHANNEL, type GeneralSettingsView } from '@/contract/rpc';
import { createDispatcher, type RpcHandlers } from '@/platform/rpc/server';
import { ReadOnlyRecordError } from '@/platform/storage';

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
const OPTIONS = { id: EXTENSION_ID, url: `chrome-extension://${EXTENSION_ID}/options.html` };
const CONTENT = { id: EXTENSION_ID, url: 'https://example.com/', tab: { id: 1 }, frameId: 0 };

const view: GeneralSettingsView = {
  settings: { theme: 'dark', logLevel: 'info' },
  status: 'ok',
  readOnly: false,
  quarantined: false,
};

function setup(overrides: Partial<RpcHandlers> = {}) {
  const handlers: RpcHandlers = {
    'settings.get': vi.fn(() => Promise.resolve(view)),
    'settings.patch': vi.fn(() => Promise.resolve(view)),
    ...overrides,
  };
  return { handlers, dispatch: createDispatcher(handlers, EXTENSION_ID) };
}

const request = (method: string, input: unknown = {}) => ({ channel: RPC_CHANNEL, method, input });

describe('RPC dispatcher', () => {
  it('runs an allowed call and returns the validated output', async () => {
    const { dispatch, handlers } = setup();

    const reply = await dispatch(request('settings.patch', { theme: 'dark' }), OPTIONS);

    expect(reply).toEqual({ ok: true, value: view });
    expect(handlers['settings.patch']).toHaveBeenCalledWith(
      { theme: 'dark' },
      { caller: 'options' },
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
