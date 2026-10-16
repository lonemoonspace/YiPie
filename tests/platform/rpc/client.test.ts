import { describe, expect, it } from 'vitest';
import { RPC_CHANNEL, type GeneralSettingsView } from '@/contract/rpc';
import { callRpc, RpcError, type Transport } from '@/platform/rpc/client';
import { createDispatcher } from '@/platform/rpc/server';
import { stubHandlers } from '../../helpers/rpc-handlers';

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
const OPTIONS = { id: EXTENSION_ID, url: `chrome-extension://${EXTENSION_ID}/options.html` };

const view: GeneralSettingsView = {
  settings: {
    theme: 'light',
    logLevel: 'warn',
    trimming: 'back',
    fontSize: 'medium',
    answerLanguage: 'interface',
    interfaceLanguage: 'auto',
  },
  status: 'ok',
  readOnly: false,
  quarantined: false,
  locale: 'zh-Hans',
};

describe('callRpc', () => {
  it('sends the method and input on our channel and returns the value', async () => {
    const sent: unknown[] = [];
    const transport: Transport = (request) => {
      sent.push(request);
      return Promise.resolve({ ok: true, value: view });
    };

    await expect(callRpc('settings.get', {}, transport)).resolves.toEqual(view);
    expect(sent).toEqual([{ channel: RPC_CHANNEL, method: 'settings.get', input: {} }]);
  });

  it('throws an RpcError carrying the server error code', async () => {
    const transport: Transport = () =>
      Promise.resolve({ ok: false, error: { code: 'forbidden', message: 'no' } });

    const call = callRpc('settings.patch', { theme: 'dark' }, transport);
    await expect(call).rejects.toBeInstanceOf(RpcError);
    await expect(call).rejects.toMatchObject({ code: 'forbidden', message: 'no' });
  });

  it('rejects a reply that does not follow the contract', async () => {
    await expect(callRpc('settings.get', {}, () => Promise.resolve(undefined))).rejects.toThrow();
    await expect(
      callRpc('settings.get', {}, () => Promise.resolve({ ok: true, value: { status: 'ok' } })),
    ).rejects.toThrow();
  });

  it('round-trips through the dispatcher', async () => {
    let stored = view;
    const dispatch = createDispatcher(
      stubHandlers({
        'settings.get': () => Promise.resolve(stored),
        'settings.patch': (patch) => {
          stored = { ...stored, settings: { ...stored.settings, ...patch } };
          return Promise.resolve(stored);
        },
      }),
      EXTENSION_ID,
      { storageIsolated: () => Promise.resolve(), panelAttached: () => Promise.resolve(false) },
    );
    const transport: Transport = (request) => dispatch(request, OPTIONS);

    await callRpc('settings.patch', { theme: 'dark' }, transport);
    await expect(callRpc('settings.get', {}, transport)).resolves.toMatchObject({
      settings: { theme: 'dark', logLevel: 'warn' },
    });
  });
});
