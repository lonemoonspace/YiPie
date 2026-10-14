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
import { NotFoundError } from '@/platform/settings/errors';
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

export interface DispatcherOptions {
  /**
   * Resolves once `storage.local` is closed to content scripts. No handler
   * runs before that, and every call is refused while it rejects.
   */
  storageIsolated: () => Promise<void>;
}

/**
 * Turns one incoming message into a reply. Every check lives here, so no
 * handler can skip one: the method must exist, the caller must be allowed to
 * call it, the input must match the contract, storage must be isolated, and
 * the handler's output must match the contract too.
 */
export function createDispatcher(
  handlers: RpcHandlers,
  extensionId: string,
  { storageIsolated }: DispatcherOptions,
) {
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

    // Fail closed: a request that arrives during start-up waits here, and none
    // is served if the browser will not restrict storage.local.
    try {
      await storageIsolated();
    } catch (error) {
      logger.error('Refused', method, 'because storage.local is not isolated:', error);
      return failure(
        'storage-not-isolated',
        `storage.local could not be closed to content scripts, so requests are refused: ${messageOf(error)}`,
      );
    }

    try {
      const handler = handlers[method as RpcMethod] as AnyHandler;
      const value = await handler(input.data, { caller });
      return { ok: true, value: definition.output.parse(value) };
    } catch (error) {
      if (error instanceof ReadOnlyRecordError) return failure('read-only', error.message);
      if (error instanceof NotFoundError) return failure('not-found', error.message);
      logger.error(method, 'failed', error);
      return failure('internal', messageOf(error));
    }
  };
}

/** Must run synchronously at service-worker start, so no message is missed. */
export function registerRpcServer(handlers: RpcHandlers, options: DispatcherOptions): void {
  const dispatch = createDispatcher(handlers, browser.runtime.id, options);

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!isRpcMessage(message)) return false;
    void dispatch(message, sender).then(sendResponse);
    // Keeps the channel open for the asynchronous reply.
    return true;
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function describe(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map(String).join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}
