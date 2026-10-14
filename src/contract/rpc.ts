import { z } from 'zod';
import { BackupRef, BackupsView } from './backups';
import { GeneralSettings, GeneralSettingsPatch } from './general-settings';
import { ModelConfig, ModelConfigDraft, ModelConfigPatch } from './model-config';
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
 * A list as read: its readable items (unreadable rows are kept in storage but
 * never sent), the default in effect, and the same read-state flags as
 * general settings.
 */
function listView<Item extends z.ZodType>(item: Item) {
  return z.object({
    items: z.array(item),
    /** The default in effect: the stored one, or the first item; `null` for an empty list. */
    defaultId: z.string().nullable(),
    status: z.enum(['ok', 'missing', 'invalid']),
    readOnly: z.boolean(),
    quarantined: z.boolean(),
  });
}

const ItemRef = z.object({ id: z.string(), name: z.string() });

/** The change removed the default, which fell back to `to` (or to nothing). */
export const FallbackView = z.object({ from: ItemRef, to: ItemRef.nullable() });
export type FallbackView = z.infer<typeof FallbackView>;

export const ModelConfigsView = listView(ModelConfig);
export type ModelConfigsView = z.infer<typeof ModelConfigsView>;

/** A list after a change: the new view, the fallback if any, and host permissions given back. */
export const ModelConfigsChange = ModelConfigsView.extend({
  fallback: FallbackView.nullable(),
  /** Origins (as permission patterns) that no configuration uses any more and were given back. */
  released: z.array(z.string()),
});
export type ModelConfigsChange = z.infer<typeof ModelConfigsChange>;

export const PromptConfigsView = listView(PromptConfig);
export type PromptConfigsView = z.infer<typeof PromptConfigsView>;

export const PromptConfigsChange = PromptConfigsView.extend({ fallback: FallbackView.nullable() });
export type PromptConfigsChange = z.infer<typeof PromptConfigsChange>;

/** A draft after the server parsed it: defaults filled in. */
export type ParsedModelConfigDraft = z.output<typeof ModelConfigDraft>;
export type ParsedPromptConfigDraft = z.output<typeof PromptConfigDraft>;

/**
 * What the panel gets for one run: names to choose from, the full
 * configuration of the default model only, and the prompt in effect. The
 * panel never receives the other models' keys.
 */
export const PanelSetup = z.object({
  models: z.array(ItemRef),
  model: ModelConfig.nullable(),
  prompt: z.object({ name: z.string(), system: z.string(), user: z.string() }),
});
export type PanelSetup = z.infer<typeof PanelSetup>;

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
  // Every model with its key: the settings page only. The panel gets
  // `panel.setup`, which carries the key of the default model alone.
  'models.list': {
    input: z.strictObject({}),
    output: ModelConfigsView,
    callers: ['options'],
  },
  'models.add': {
    input: ModelConfigDraft,
    output: ModelConfigsChange,
    callers: ['options'],
  },
  'models.update': {
    input: updateInput(ModelConfigPatch),
    output: ModelConfigsChange,
    callers: ['options'],
  },
  'models.remove': {
    input: RemoveInput,
    output: ModelConfigsChange,
    callers: ['options'],
  },
  'models.move': {
    input: MoveInput,
    output: ModelConfigsChange,
    callers: ['options'],
  },
  // The one change the panel may make: its model dropdown sets the global
  // default (docs/development-plan.md §4.3, decision 7). The reply carries no
  // list, so no key reaches the panel this way.
  'models.setDefault': {
    input: SetDefaultInput,
    output: z.object({ defaultId: z.string() }),
    callers: ['options', 'panel'],
  },
  'prompts.list': {
    input: z.strictObject({}),
    output: PromptConfigsView,
    callers: ['options'],
  },
  'prompts.add': {
    input: PromptConfigDraft,
    output: PromptConfigsChange,
    callers: ['options'],
  },
  'prompts.update': {
    input: updateInput(PromptConfigPatch),
    output: PromptConfigsChange,
    callers: ['options'],
  },
  'prompts.remove': {
    input: RemoveInput,
    output: PromptConfigsChange,
    callers: ['options'],
  },
  'prompts.move': {
    input: MoveInput,
    output: PromptConfigsChange,
    callers: ['options'],
  },
  'prompts.setDefault': {
    input: SetDefaultInput,
    output: z.object({ defaultId: z.string() }),
    callers: ['options'],
  },
  // Backups of unreadable values: they may contain API keys, so the settings page only.
  'backups.list': {
    input: z.strictObject({}),
    output: BackupsView,
    callers: ['options'],
  },
  'backups.remove': {
    input: BackupRef,
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
  // Everything a run needs but the page: model choices, the default model and the prompt.
  'panel.setup': {
    input: z.strictObject({}),
    output: PanelSetup,
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
