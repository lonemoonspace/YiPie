import { useEffect, useState } from 'react';
import { callRpc } from '@/platform/rpc/client';

export type AttachState =
  { kind: 'attaching' } | { kind: 'attached'; tabId: number } | { kind: 'failed'; message: string };

/**
 * Presents the nonce our content script put in this frame's URL. Until the
 * background accepts it, the panel gets no page data (docs/development-plan.md
 * §2.1); a `panel.html` that someone else embedded never gets past this.
 */
export function useAttach(): AttachState {
  const [state, setState] = useState<AttachState>({ kind: 'attaching' });

  useEffect(() => {
    let active = true;
    const nonce = window.location.hash.slice(1);
    callRpc('panel.attach', { nonce }).then(
      ({ tabId }) => active && setState({ kind: 'attached', tabId }),
      (error: unknown) =>
        active &&
        setState({
          kind: 'failed',
          message: error instanceof Error ? error.message : String(error),
        }),
    );
    return () => {
      active = false;
    };
  }, []);

  return state;
}
