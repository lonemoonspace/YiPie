import { z } from 'zod';
import { BackedUpKey, BackupsView } from './backups';
import { ConfigImport } from './config-transfer';
import {
  AnswerLanguage,
  FontSize,
  GeneralSettings,
  GeneralSettingsPatch,
  Theme,
  TrimmingStrategy,
} from './general-settings';
import {
  BaseURL,
  ExtraBody,
  HeaderMap,
  ModelConfig,
  ModelConfigDraft,
  ModelConfigPatch,
} from './model-config';
import { ItemId, MoveInput, RemoveInput, SetDefaultInput, updateInput } from './mutations';
import { PageContext } from './page-context';
import { PromptConfig, PromptConfigDraft, PromptConfigPatch } from './prompt-config';
import { LOCALES, PANEL_MODES, RPC_CHANNEL, RPC_ERROR_CODES } from './rpc-wire';
import { SnapshotMessage } from './snapshot';

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

/** The interface language, resolved: what `auto` in the settings means on this browser. */
export const Locale = z.enum(LOCALES);

/**
 * The general settings a panel uses, field by field: `GeneralSettings` keeps
 * fields it does not know (`z.looseObject`), and those have no business in
 * the panel (docs/development-plan.md §4.3, decision 8).
 */
export const PanelSettings = z.object({
  trimming: TrimmingStrategy,
  theme: Theme,
  fontSize: FontSize,
  answerLanguage: AnswerLanguage,
  autoSummarize: z.boolean(),
  locale: Locale,
});
export type PanelSettings = z.infer<typeof PanelSettings>;

export const GeneralSettingsView = z.object({
  settings: GeneralSettings,
  /** How the stored value read; with `invalid`, `settings` holds defaults. */
  status: ReadStatus,
  /** Written by a newer version of the extension: shown, but edits are refused. */
  readOnly: z.boolean(),
  /** This write replaced an unreadable value, which was backed up first. */
  quarantined: z.boolean(),
  /** The interface language these settings resolve to on this browser. */
  locale: Locale,
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

/**
 * One configuration in the panel's model menu: names, no credentials. `models`
 * is what the menu offers under it (`menuModelNames`), `model` among them.
 */
export const ModelChoice = z.object({
  id: z.string(),
  name: z.string(),
  model: z.string(),
  models: z.array(z.string()),
});
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

/**
 * The conversation saved for the panel's page in its tab, as the panel
 * restores it (docs/development-plan.md §4.4, decision 3).
 */
export const SnapshotView = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('found'),
    messages: z.array(SnapshotMessage),
    /** The oldest messages were dropped to keep the page under its limit. */
    truncated: z.boolean(),
  }),
  z.object({ status: z.literal('none') }),
  /** A conversation was saved, then evicted to make room for other pages. */
  z.object({ status: z.literal('evicted') }),
]);
export type SnapshotView = z.infer<typeof SnapshotView>;

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
  // What the panel needs of the general settings, and nothing else.
  'settings.current': {
    input: z.strictObject({}),
    output: PanelSettings,
    callers: ['panel'],
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
  // With `model`, the configuration's model name changes to it too, one of
  // the names its menu offers and nothing else.
  'models.choose': {
    input: SetDefaultInput.extend({ model: z.string().min(1).max(200).optional() }),
    output: PanelModelsView,
    callers: ['panel'],
  },
  // The other one: the service of a model refused `stream_options`, so the
  // panel stops asking it for usage (docs/development-plan.md §4.5, decision
  // 2; listed as an exception in §8). It can only turn the option off.
  'models.disableStreamUsage': {
    input: z.strictObject({ id: ItemId }),
    output: PanelModelsView,
    callers: ['panel'],
  },
  // The panel reads the prompts for its menu and the default it summarizes
  // with; it can only pick the default, through `prompts.choose`.
  'prompts.list': {
    input: z.strictObject({}),
    output: PromptConfigsView,
    callers: ['options', 'panel'],
  },
  // The panel's prompt menu sets the global default, as its model menu does
  // (docs/development-plan.md §4.3, decision 7; listed as an exception in §8).
  // Everything else about prompts changes only in the settings page.
  'prompts.choose': {
    input: SetDefaultInput,
    output: PromptConfigsView,
    callers: ['panel'],
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
  // An import file the settings page read and the user confirmed: each list
  // gets its items appended with fresh ids (docs/development-plan.md §4.6).
  'config.import': {
    input: ConfigImport,
    output: z.object({ models: ModelConfigsView, prompts: PromptConfigsView }),
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
  // to mount in its tab (docs/development-plan.md §2.1, §8), and the page the
  // panel is bound to, worked out from the URL the browser reports. The host
  // closes the panel once the document is another page (§4.4, detail 12).
  // `mode` says what the trigger asked for: the page, or the selection.
  'content.hello': {
    input: z.strictObject({ mode: z.enum(PANEL_MODES).optional() }),
    // The theme and the language let the shell around the panel match it.
    output: z.object({ nonce: z.string(), pageKey: z.string(), theme: Theme, locale: Locale }),
    callers: ['content'],
  },
  // A panel proves it was mounted by our content script in the same tab, and
  // learns what it works on.
  'panel.attach': {
    input: z.strictObject({ nonce: z.string().min(1).max(100) }),
    output: z.object({ tabId: z.number().int(), mode: z.enum(PANEL_MODES) }),
    callers: ['panel'],
    beforeAttach: true,
  },
  // Only the panel attached in a tab may read that tab's page.
  'page.getContext': {
    input: z.strictObject({}),
    output: PageContext,
    callers: ['panel'],
  },
  // Finds a quote of an answer in the panel's page, scrolls to it and
  // highlights it (docs/development-plan.md §4.6).
  'page.locate': {
    input: z.strictObject({ quote: z.string().trim().min(1).max(1_000) }),
    output: z.object({ found: z.boolean() }),
    callers: ['panel'],
  },
  // The conversation of the page the panel was mounted on, in its own tab: a
  // panel names neither, so it cannot reach another tab's or page's.
  'snapshot.get': {
    input: z.strictObject({}),
    output: SnapshotView,
    callers: ['panel'],
  },
  // Saves the panel's whole conversation (answers and follow-up questions,
  // never the page or a credential) in session storage. `revision` counts
  // this panel's saves: one older than the last one stored arrived late and
  // is ignored (`stored: false`). An empty conversation means the user
  // started over, so nothing is restored for the page any more.
  'snapshot.save': {
    input: z.strictObject({
      messages: z.array(SnapshotMessage).max(1_000),
      revision: z.number().int().nonnegative(),
    }),
    output: z.object({ stored: z.boolean(), truncated: z.boolean() }),
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
