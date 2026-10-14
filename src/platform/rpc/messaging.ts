import { RPC_CHANNEL, type RpcErrorCode, type RpcReply } from '@/contract/rpc';

/** Cheap check that lets the listener ignore messages that are not ours. */
export function isRpcMessage(message: unknown): boolean {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { channel?: unknown }).channel === RPC_CHANNEL
  );
}

export function failure(code: RpcErrorCode, message: string): RpcReply {
  return { ok: false, error: { code, message } };
}
