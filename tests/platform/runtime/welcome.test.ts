import { describe, expect, it, vi } from 'vitest';
import { openWelcomeOnInstall, openWelcomePage, type WelcomeApi } from '@/platform/runtime/welcome';

function fakeApi(open: WelcomeApi['open'] = () => Promise.resolve()) {
  let installed: ((details: { reason: string }) => void) | undefined;
  const api = {
    onInstalled: (listener: (details: { reason: string }) => void) => (installed = listener),
    open: vi.fn(open),
  } satisfies WelcomeApi;
  return { api, install: (reason: string) => installed?.({ reason }) };
}

describe('the first-run page', () => {
  it('opens when the extension is installed', () => {
    const { api, install } = fakeApi();
    openWelcomeOnInstall(api);
    install('install');
    expect(api.open).toHaveBeenCalledExactlyOnceWith('#welcome');
  });

  it('stays closed on an update, a browser update or a shared module update', () => {
    const { api, install } = fakeApi();
    openWelcomeOnInstall(api);
    for (const reason of ['update', 'chrome_update', 'shared_module_update']) install(reason);
    expect(api.open).not.toHaveBeenCalled();
  });

  it('does not let a tab that could not open reject anything', async () => {
    const { api, install } = fakeApi(() => Promise.reject(new Error('no window')));
    openWelcomeOnInstall(api);
    install('install');
    await Promise.resolve();
    expect(api.open).toHaveBeenCalledOnce();
  });

  it('opens on the way in the panel asked for', async () => {
    const { api } = fakeApi();
    await openWelcomePage('free', api);
    expect(api.open).toHaveBeenCalledExactlyOnceWith('#welcome/free');
  });
});
