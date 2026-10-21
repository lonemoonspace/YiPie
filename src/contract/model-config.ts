import { z } from 'zod';
import type { StorageKey } from './storage';

export const MODEL_CONFIGS_KEY = 'local:model-configs' satisfies StorageKey;
export const MODEL_CONFIGS_VERSION = 1;

/** Only http(s) endpoints; `normalizeBaseURL` in domain/url tidies input first. */
export const BaseURL = z.url({ protocol: /^https?$/ });

/**
 * Extra request headers. Values must be strings: `fetch` would turn anything
 * else into text the user never wrote.
 */
export const HeaderMap = z.record(z.string(), z.string());

/**
 * Request headers browsers do not let a page or an extension set: the Fetch
 * standard's forbidden request-header names (`Cookie`, `Host`, `Origin`…) and
 * every `Proxy-` or `Sec-` name. `fetch` drops them without a word.
 */
const FORBIDDEN_HEADER_NAMES = new Set([
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'referer',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
]);

export function isForbiddenHeaderName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    FORBIDDEN_HEADER_NAMES.has(lower) || lower.startsWith('proxy-') || lower.startsWith('sec-')
  );
}

/**
 * Headers as the settings page submits them. A forbidden name is refused
 * rather than saved as if it would be sent. Stored data is read with the
 * plain `HeaderMap`: such a header there is harmless, the browser drops it.
 */
const HeaderMapInput = HeaderMap.superRefine((headers, context) => {
  for (const name of Object.keys(headers)) {
    if (isForbiddenHeaderName(name)) {
      context.addIssue({
        code: 'custom',
        path: [name],
        message: `Browsers do not let extensions set the ${name} header.`,
      });
    }
  }
});

/**
 * JSON merged into the request body, for parameters some services need
 * (`temperature`, `max_tokens`…). It cannot override `model`, `messages` or
 * `stream` (see domain/llm/request).
 */
export const ExtraBody = z.record(z.string(), z.unknown());

/** Body fields the protocol needs; `extraBody` cannot override them. */
export const RESERVED_BODY_KEYS: readonly string[] = ['model', 'messages', 'stream'];

/**
 * Extra body fields as the settings page submits them: a reserved field is
 * refused rather than saved as if it would be sent. Stored data is read with
 * the plain `ExtraBody`; the request leaves such a field out.
 */
const ExtraBodyInput = ExtraBody.superRefine((body, context) => {
  for (const key of Object.keys(body)) {
    if (RESERVED_BODY_KEYS.includes(key)) {
      context.addIssue({
        code: 'custom',
        path: [key],
        message: `The request sets ${key} itself; extra body fields cannot replace it.`,
      });
    }
  }
});

/**
 * One OpenAI-compatible endpoint (D1): base URL, key and model name, plus the
 * three places services differ. Stored as `{ version, data: ModelConfig[] }`:
 * a list from the start, though phase 1 edits a single entry
 * (docs/development-plan.md §4.2).
 *
 * As with every stored shape, each field has a default and unknown fields pass
 * through, so adding a field needs no version bump.
 */
export const ModelConfig = z.looseObject({
  id: z.string().min(1),
  /** Shown in the UI; empty means "use the model name". */
  name: z.string().default(''),
  baseURL: BaseURL,
  /** Empty for servers that take no key, such as a local Ollama. */
  apiKey: z.string().default(''),
  model: z.string().min(1),
  /**
   * Other model names of the same service, offered in the panel's model menu
   * next to `model`; picking one there makes it `model`. Empty: the menu
   * offers this configuration by its name alone, as before.
   */
  menuModels: z.array(z.string()).default([]),
  headers: HeaderMap.default({}),
  extraBody: ExtraBody.default({}),
  /** Tokens the model accepts. Used only for budgeting; never sent. */
  contextWindow: z.number().int().positive().nullable().default(null),
  /** Ask for `usage` in the stream (`stream_options.include_usage`). */
  streamUsage: z.boolean().default(true),
});
export type ModelConfig = z.infer<typeof ModelConfig>;

export const ModelConfigList = z.array(ModelConfig);
export type ModelConfigList = z.infer<typeof ModelConfigList>;

/** Most names one configuration's menu may hold. */
export const MAX_MENU_MODELS = 50;

/** `menuModels` as the settings page submits it: names, each once, none empty. */
const MenuModels = z
  .array(z.string().trim().min(1))
  .max(MAX_MENU_MODELS)
  .refine((names) => new Set(names).size === names.length, 'Each model name only once.');

/** What the settings page submits to create a configuration; the id is assigned on save. */
export const ModelConfigDraft = z.strictObject({
  name: z.string().default(''),
  baseURL: BaseURL,
  apiKey: z.string().default(''),
  model: z.string().trim().min(1),
  menuModels: MenuModels.default([]),
  headers: HeaderMapInput.default({}),
  extraBody: ExtraBodyInput.default({}),
  contextWindow: z.number().int().positive().nullable().default(null),
  streamUsage: z.boolean().default(true),
});
export type ModelConfigDraft = z.input<typeof ModelConfigDraft>;

/**
 * Changes to one configuration. Every field is optional and carries no
 * default, for the reason given on `GeneralSettingsPatch`.
 */
export const ModelConfigPatch = z.strictObject({
  name: z.string().optional(),
  baseURL: BaseURL.optional(),
  apiKey: z.string().optional(),
  model: z.string().trim().min(1).optional(),
  menuModels: MenuModels.optional(),
  headers: HeaderMapInput.optional(),
  extraBody: ExtraBodyInput.optional(),
  contextWindow: z.number().int().positive().nullable().optional(),
  streamUsage: z.boolean().optional(),
});
export type ModelConfigPatch = z.infer<typeof ModelConfigPatch>;

/** The name to show for a configuration. */
export function displayName(config: Pick<ModelConfig, 'name' | 'model'>): string {
  return config.name.trim() || config.model;
}

/**
 * The model names the panel's menu offers for a configuration: `menuModels`,
 * with `model` first when the list does not have it. A pick in the panel
 * keeps this whole list (see `pickMenuModel`), so nothing on it disappears.
 */
export function menuModelNames(config: Pick<ModelConfig, 'model' | 'menuModels'>): string[] {
  const names = config.menuModels.filter((name) => name.trim() !== '');
  return [...new Set(names.includes(config.model) ? names : [config.model, ...names])];
}
