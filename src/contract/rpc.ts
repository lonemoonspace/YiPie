import { z } from 'zod';
import { GeneralSettings, GeneralSettingsPatch } from './general-settings';

/**
 * The contexts that call the background, told apart by the browser-supplied
 * `sender` (see platform/rpc/caller-policy).
 */
export type CallerKind = 'options' | 'panel' | 'content';

export interface MethodDefinition {
  input: z.ZodType;
  output: z.ZodType;
  /** Who may call the method. Anyone not listed is refused (docs/development-plan.md §8). */
  callers: readonly CallerKind[];
}

export const GeneralSettingsView = z.object({
  settings: GeneralSettings,
  /** How the stored value read; with `invalid`, `settings` holds defaults. */
  status: z.enum(['ok', 'missing', 'invalid']),
  /** Written by a newer version of the extension: shown, but edits are refused. */
  readOnly: z.boolean(),
  /** This write replaced an unreadable value, which was backed up first. */
  quarantined: z.boolean(),
});
export type GeneralSettingsView = z.infer<typeof GeneralSettingsView>;

/**
 * Every background method. A method that is not listed here does not exist,
 * and a caller kind that is not listed for a method may not call it.
 */
export const RPC_METHODS = {
  'settings.get': {
    input: z.strictObject({}),
    output: GeneralSettingsView,
    callers: ['options'],
  },
  'settings.patch': {
    input: GeneralSettingsPatch,
    output: GeneralSettingsView,
    callers: ['options'],
  },
} as const satisfies Record<string, MethodDefinition>;

export type RpcMethods = typeof RPC_METHODS;
export type RpcMethod = keyof RpcMethods;
/** What a caller sends. */
export type RpcInput<M extends RpcMethod> = z.input<RpcMethods[M]['input']>;
/** What a handler receives, after the server has parsed the input. */
export type RpcParsedInput<M extends RpcMethod> = z.output<RpcMethods[M]['input']>;
export type RpcOutput<M extends RpcMethod> = z.output<RpcMethods[M]['output']>;

/** Marks our messages, so the listener can ignore everything else. */
export const RPC_CHANNEL = 'yipie.rpc/1';

export const RpcRequest = z.object({
  channel: z.literal(RPC_CHANNEL),
  method: z.string(),
  input: z.unknown(),
});
export type RpcRequest = z.infer<typeof RpcRequest>;

export const RPC_ERROR_CODES = [
  'forbidden',
  'unknown-method',
  'bad-request',
  'read-only',
  'internal',
] as const;
export const RpcErrorCode = z.enum(RPC_ERROR_CODES);
export type RpcErrorCode = z.infer<typeof RpcErrorCode>;

export const RpcReply = z.union([
  z.object({ ok: z.literal(true), value: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.object({ code: RpcErrorCode, message: z.string() }) }),
]);
export type RpcReply = z.infer<typeof RpcReply>;
