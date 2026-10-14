import { z } from 'zod';
import { GeneralSettings, GeneralSettingsPatch } from './general-settings';
import { ModelConfigDraft, ModelConfigList, ModelConfigPatch } from './model-config';
import { PageContext } from './page-context';
import { RPC_CHANNEL, RPC_ERROR_CODES } from './rpc-wire';

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

/** Model configurations as read, with the same read-state flags as general settings. */
export const ModelConfigsView = z.object({
  configs: ModelConfigList,
  status: z.enum(['ok', 'missing', 'invalid']),
  readOnly: z.boolean(),
  quarantined: z.boolean(),
});
export type ModelConfigsView = z.infer<typeof ModelConfigsView>;

/** A draft after the server parsed it: defaults filled in. */
export type ParsedModelConfigDraft = z.output<typeof ModelConfigDraft>;

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
  // The panel needs the key to call the model; it is an extension page, so the
  // key never reaches a content script or the page (docs/development-plan.md §8).
  'models.list': {
    input: z.strictObject({}),
    output: ModelConfigsView,
    callers: ['options', 'panel'],
  },
  'models.add': {
    input: ModelConfigDraft,
    output: ModelConfigsView,
    callers: ['options'],
  },
  'models.update': {
    input: z.strictObject({ id: z.string().min(1), patch: ModelConfigPatch }),
    output: ModelConfigsView,
    callers: ['options'],
  },
  // The content script's only method: a nonce for the panel frame it is about
  // to mount in its tab (docs/development-plan.md §2.1, §8).
  'content.hello': {
    input: z.strictObject({}),
    output: z.object({ nonce: z.string() }),
    callers: ['content'],
  },
  // A panel proves it was mounted by our content script in the same tab.
  'panel.attach': {
    input: z.strictObject({ nonce: z.string().min(1).max(100) }),
    output: z.object({ tabId: z.number().int() }),
    callers: ['panel'],
  },
  // Only the panel attached in a tab may read that tab's page.
  'page.getContext': {
    input: z.strictObject({}),
    output: PageContext,
    callers: ['panel'],
  },
} as const satisfies Record<string, MethodDefinition>;

export type RpcMethods = typeof RPC_METHODS;
export type RpcMethod = keyof RpcMethods;
/** What a caller sends. */
export type RpcInput<M extends RpcMethod> = z.input<RpcMethods[M]['input']>;
/** What a handler receives, after the server has parsed the input. */
export type RpcParsedInput<M extends RpcMethod> = z.output<RpcMethods[M]['input']>;
export type RpcOutput<M extends RpcMethod> = z.output<RpcMethods[M]['output']>;

export { RPC_CHANNEL };

export const RpcRequest = z.object({
  channel: z.literal(RPC_CHANNEL),
  method: z.string(),
  input: z.unknown(),
});
export type RpcRequest = z.infer<typeof RpcRequest>;

export const RpcErrorCode = z.enum(RPC_ERROR_CODES);
export type RpcErrorCode = z.infer<typeof RpcErrorCode>;

export const RpcReply = z.union([
  z.object({ ok: z.literal(true), value: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.object({ code: RpcErrorCode, message: z.string() }) }),
]);
export type RpcReply = z.infer<typeof RpcReply>;
