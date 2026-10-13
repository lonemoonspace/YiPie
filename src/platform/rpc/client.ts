import { browser } from 'wxt/browser';
import {
  RPC_CHANNEL,
  RPC_METHODS,
  RpcReply,
  type RpcErrorCode,
  type RpcInput,
  type RpcMethod,
  type RpcOutput,
  type RpcRequest,
} from '@/contract/rpc';

export class RpcError extends Error {
  readonly code: RpcErrorCode;

  constructor(code: RpcErrorCode, message: string) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
  }
}

export type Transport = (request: RpcRequest) => Promise<unknown>;

const runtimeTransport: Transport = (request) => browser.runtime.sendMessage(request);

/**
 * Calls a background method from an extension page and checks the reply
 * against the contract. (Content scripts will get a zod-free variant in
 * phase 1 — validation there belongs to the server.)
 */
export async function callRpc<M extends RpcMethod>(
  method: M,
  input: RpcInput<M>,
  transport: Transport = runtimeTransport,
): Promise<RpcOutput<M>> {
  const reply = RpcReply.parse(await transport({ channel: RPC_CHANNEL, method, input }));
  if (!reply.ok) throw new RpcError(reply.error.code, reply.error.message);
  return RPC_METHODS[method].output.parse(reply.value) as RpcOutput<M>;
}
