import { vi } from 'vitest';
import { RPC_METHODS, type RpcMethod } from '@/contract/rpc';
import type { RpcHandlers } from '@/platform/rpc/server';

/** A handler for every method; those not given fail the call if a test reaches them. */
export function stubHandlers(overrides: Partial<RpcHandlers> = {}): RpcHandlers {
  const entries = (Object.keys(RPC_METHODS) as RpcMethod[]).map((method) => [
    method,
    overrides[method] ?? vi.fn(() => Promise.reject(new Error(`Unexpected call to ${method}`))),
  ]);
  return Object.fromEntries(entries) as RpcHandlers;
}
