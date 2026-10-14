import { z } from 'zod';
import { BackedUpKey, BackupsView } from './backups';
import { GeneralSettings, GeneralSettingsPatch } from './general-settings';
import {
  BaseURL,
  ExtraBody,
  HeaderMap,
  ModelConfig,
  ModelConfigDraft,
  ModelConfigPatch,
} from './model-config';
import { MoveInput, RemoveInput, SetDefaultInput, updateInput } from './mutations';
import { PageContext } from './page-context';
import { PromptConfig, PromptConfigDraft, PromptConfigPatch } from './prompt-config';
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
  /**
   * A panel may call this before it has attached. Every other panel call is
   * refused unless the sender is the panel attached in its tab: `panel.html`
   * is web-accessible, so being a panel document proves nothing by itself.
   */
  beforeAttach?: true;
}

/** How a stored value read (docs/development-plan.md §7). */
export const ReadStatus = z.enum(['ok', 'missing', 'invalid']);
export type ReadStatus = z.infer<typeof ReadStatus>;

export const GeneralSettingsView = z.object({
  settings: GeneralSettings,
  /** How the stored value read; with `invalid`, `settings` holds defaults. */
  status: ReadStatus,
  /** Written by a newer version of the extension: shown, but edits are refused. */
  readOnly: z.boolean(),
  /** This write replaced an unreadable value, which was backed up first. */
  quarantined: z.boolean(),
});
export type GeneralSettingsView = z.infer<typeof GeneralSettingsView>;

/**
 * A list of configurations as the background read it, or as a change left
 * it, with everything the settings page shows about it. Every judgement is
 * made here, so the page only renders (docs/development-plan.md §4.3).
 */
function listView<Item extends z.ZodType>(item: Item) {
  return z.object({
    /** The rows this version can read, in order. */
    items: z.array(item),
    /** The item in use: the chosen default, or the first item; null only when there is none. */
    defaultId: z.string().nullable(),
    /** Rows this version cannot read. Kept and written back unchanged, never shown. */
    unrecognized: z.number().int().nonnegative(),
    /** How the list read; with `invalid`, `items` holds the defaults. */
    status: ReadStatus,
    /** Written by a newer version of the extension: shown, but changes are refused. */
    readOnly: z.boolean(),
    /** This change replaced an unreadable value, which was backed up first. */
    quarantined: z.boolean(),
    /** This change removed the default, so the first item (or none) took over. */
    defaultFellBack: z.boolean(),
    /** The stored choice of default could not be read; the first item stands in. */
    defaultUnreadable: z.boolean(),
  });
}

/** `listView` for items of type `T`. */
export type ListView<T> = Omit<z.infer<ReturnType<typeof listView>>, 'items'> & { items: T[] };

export const ModelConfigsView = listView(ModelConfig);
export type ModelConfigsView = z.infer<typeof ModelConfigsView>;

/** One entry of the panel's model menu: a name, no credentials. */
export const ModelChoice = z.object({ id: z.string(), name: z.string() });
export type ModelChoice = z.infer<typeof ModelChoice>;

/**
 * The model in use, as the panel receives it: the fields a request needs and
 * nothing else. `ModelConfig` keeps fields it does not know (`z.looseObject`),
 * so whatever else is stored on the row (a field a newer version added,
 * anything odd) would ride along; this schema drops it, after
 * `forPanel` has already copied the known fields one by one.
 */
export const PanelModelConfig = z.object({
  id: z.string(),
  name: z.string(),
  baseURL: BaseURL,
  apiKey: z.string(),
  model: z.string(),
  headers: HeaderMap,
  extraBody: ExtraBody,
  contextWindow: z.number().int().positive().nullable(),
  streamUsage: z.boolean(),
});
export type PanelModelConfig = z.infer<typeof PanelModelConfig>;

/**
 * What the panel gets about models: the menu, without credentials, and the
 * one model in use (the default). The panel needs that key to call the model
 * and no other, so it never holds another model's key
 * (docs/development-plan.md §4.3, §8).
 */
export const PanelModelsView = z.object({
  choices: z.array(ModelChoice),
  current: PanelModelConfig.nullable(),
});
export type PanelModelsView = z.infer<typeof PanelModelsView>;

export const PromptConfigsView = listView(PromptConfig);
export type PromptConfigsView = z.infer<typeof PromptConfigsView>;

/** A draft after the server parsed it: defaults filled in. */
export type ParsedModelConfigDraft = z.output<typeof ModelConfigDraft>;
export type ParsedPromptConfigDraft = z.output<typeof PromptConfigDraft>;

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
  // Every configuration, keys included: the settings page only. The panel
  // reads `models.current` instead.
  'models.list': {
    input: z.strictObject({}),
    output: ModelConfigsView,
    callers: ['options'],
  },
  'models.add': {
    input: ModelConfigDraft,
    output: ModelConfigsView,
    callers: ['options'],
  },
  'models.update': {
    input: updateInput(ModelConfigPatch),
    output: ModelConfigsView,
    callers: ['options'],
  },
  'models.remove': {
    input: RemoveInput,
    output: ModelConfigsView,
    callers: ['options'],
  },
  'models.move': {
    input: MoveInput,
    output: ModelConfigsView,
    callers: ['options'],
  },
  'models.setDefault': {
    input: SetDefaultInput,
    output: ModelConfigsView,
    callers: ['options'],
  },
  // The model menu and the model in use, with only that model's key. The key
  // stays in extension pages: it never reaches a content script or the page
  // (docs/development-plan.md §8). Like every panel call but `panel.attach`,
  // this and `models.choose` are served to attached panels only.
  'models.current': {
    input: z.strictObject({}),
    output: PanelModelsView,
    callers: ['panel'],
  },
  // The one change a panel may make: its model menu sets the global default
  // (docs/development-plan.md §4.3, decision 7; listed as an exception in §8).
  'models.choose': {
    input: SetDefaultInput,
    output: PanelModelsView,
    callers: ['panel'],
  },
  // The panel reads the default prompt; prompts change only in the settings
  // page (docs/development-plan.md §4.3, decision 7).
  'prompts.list': {
    input: z.strictObject({}),
    output: PromptConfigsView,
    callers: ['options', 'panel'],
  },
  'prompts.add': {
    input: PromptConfigDraft,
    output: PromptConfigsView,
    callers: ['options'],
  },
  'prompts.update': {
    input: updateInput(PromptConfigPatch),
    output: PromptConfigsView,
    callers: ['options'],
  },
  'prompts.remove': {
    input: RemoveInput,
    output: PromptConfigsView,
    callers: ['options'],
  },
  'prompts.move': {
    input: MoveInput,
    output: PromptConfigsView,
    callers: ['options'],
  },
  'prompts.setDefault': {
    input: SetDefaultInput,
    output: PromptConfigsView,
    callers: ['options'],
  },
  // Backups hold everything that was stored, keys included: settings page only.
  'backups.list': {
    input: z.strictObject({}),
    output: BackupsView,
    callers: ['options'],
  },
  // Deleting a backup is the user's explicit action (docs/development-plan.md §7).
  'backups.remove': {
    input: z.strictObject({ key: BackedUpKey, at: z.string().min(1).max(100) }),
    output: BackupsView,
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
    beforeAttach: true,
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
