import { browser } from 'wxt/browser';
import type { z } from 'zod';
import {
  RPC_METHODS,
  RpcRequest,
  type CallerKind,
  type MethodDefinition,
  type RpcMethod,
  type RpcOutput,
  type RpcParsedInput,
  type RpcReply,
} from '@/contract/rpc';
import { createLogger } from '@/platform/logger';
import { ReadOnlyRecordError } from '@/platform/storage';
import { classifyCaller, type SenderLike } from './caller-policy';
import { failure, isRpcMessage } from './messaging';

const logger = createLogger('rpc');

export interface HandlerContext {
  caller: CallerKind;
}

export type RpcHandlers = {
  [M in RpcMethod]: (input: RpcParsedInput<M>, context: HandlerContext) => Promise<RpcOutput<M>>;
};

type AnyHandler = (input: unknown, context: HandlerContext) => Promise<unknown>;

/**
 * Turns one incoming message into a reply. Every check lives here, so no
 * handler can skip one: the method must exist, the caller must be allowed to
 * call it, the input must match the contract, and so must the handler's
 * output.
 */
export function createDispatcher(handlers: RpcHandlers, extensionId: string) {
  return async (message: unknown, sender: SenderLike): Promise<RpcReply> => {
    const request = RpcRequest.safeParse(message);
    if (!request.success) return failure('bad-request', 'Malformed RPC request.');

    const { method } = request.data;
    if (!Object.hasOwn(RPC_METHODS, method)) {
      return failure('unknown-method', `Unknown method: ${method}`);
    }
    const definition: MethodDefinition = RPC_METHODS[method as RpcMethod];

    const caller = classifyCaller(sender, extensionId);
    if (caller === null || !definition.callers.includes(caller)) {
      logger.warn('Refused', method, 'from', caller ?? 'an unrecognized sender', sender.url);
      return failure('forbidden', `${caller ?? 'This sender'} may not call ${method}.`);
    }

    const input = definition.input.safeParse(request.data.input);
    if (!input.success) return failure('bad-request', describe(input.error));

    try {
      const handler = handlers[method as RpcMethod] as AnyHandler;
      const value = await handler(input.data, { caller });
      return { ok: true, value: definition.output.parse(value) };
    } catch (error) {
      if (error instanceof ReadOnlyRecordError) return failure('read-only', error.message);
      logger.error(method, 'failed', error);
      return failure('internal', error instanceof Error ? error.message : String(error));
    }
  };
}

/** Must run synchronously at service-worker start, so no message is missed. */
export function registerRpcServer(handlers: RpcHandlers): void {
  const dispatch = createDispatcher(handlers, browser.runtime.id);

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!isRpcMessage(message)) return false;
    void dispatch(message, sender).then(sendResponse);
    // Keeps the channel open for the asynchronous reply.
    return true;
  });
}

function describe(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map(String).join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}
