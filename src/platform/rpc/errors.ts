import type { RpcErrorCode } from '@/contract/rpc-wire';

export type RefusalCode = Extract<RpcErrorCode, 'forbidden' | 'not-found' | 'bad-request'>;

/**
 * Thrown by a handler to refuse a call it cannot serve, with the code the
 * caller sees. Anything else a handler throws is reported as `internal`.
 */
export class RpcRefusal extends Error {
  readonly code: RefusalCode;

  constructor(code: RefusalCode, message: string) {
    super(message);
    this.name = 'RpcRefusal';
    this.code = code;
  }
}
