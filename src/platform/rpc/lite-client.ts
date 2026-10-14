import { browser } from 'wxt/browser';
import type { RpcInput, RpcMethod, RpcOutput } from '@/contract/rpc';
import { RPC_CHANNEL, type RpcReplyWire, type RpcRequestWire } from '@/contract/rpc-wire';

/**
 * The content script's RPC client. Unlike `callRpc` it does not validate the
 * reply with zod: zod would weigh more than the rest of the content script,
 * and the replies come from our own service worker, which validated them
 * already. Only the types come from the contract.
 */
export async function callRpcLite<M extends RpcMethod>(
  method: M,
  input: RpcInput<M>,
): Promise<RpcOutput<M>> {
  const request: RpcRequestWire = { channel: RPC_CHANNEL, method, input };
  const reply = await browser.runtime.sendMessage<RpcRequestWire, RpcReplyWire | undefined>(
    request,
  );
  if (typeof reply !== 'object' || reply === null) {
    throw new Error(`No reply to ${method}`);
  }
  if (!reply.ok) throw new Error(`${reply.error.code}: ${reply.error.message}`);
  return reply.value as RpcOutput<M>;
}
