import {
  MAX_MENU_MODELS,
  RESERVED_BODY_KEYS,
  isForbiddenHeaderName,
  type ModelConfig,
} from '@/contract/model-config';
import { t } from '@/domain/i18n';
import { normalizeBaseURL } from '@/domain/url';

/** The model form as the user typed it: every field is text, except the checkbox. */
export interface ModelFormFields {
  name: string;
  baseURL: string;
  apiKey: string;
  model: string;
  /** One name per line. */
  menuModels: string;
  headers: string;
  extraBody: string;
  contextWindow: string;
  streamUsage: boolean;
}

export interface ParsedModelForm {
  name: string;
  baseURL: string;
  apiKey: string;
  model: string;
  menuModels: string[];
  headers: Record<string, string>;
  extraBody: Record<string, unknown>;
  contextWindow: number | null;
  streamUsage: boolean;
}

export type ModelFormErrors = Partial<Record<keyof ModelFormFields, string>>;

export type ModelFormResult =
  { ok: true; value: ParsedModelForm } | { ok: false; errors: ModelFormErrors };

export const EMPTY_MODEL_FORM: ModelFormFields = {
  name: '',
  baseURL: '',
  apiKey: '',
  model: '',
  menuModels: '',
  headers: '',
  extraBody: '',
  contextWindow: '',
  streamUsage: true,
};

export function formFromConfig(config: ModelConfig): ModelFormFields {
  return {
    name: config.name,
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    model: config.model,
    menuModels: config.menuModels.join('\n'),
    headers: isEmpty(config.headers) ? '' : JSON.stringify(config.headers, null, 2),
    extraBody: isEmpty(config.extraBody) ? '' : JSON.stringify(config.extraBody, null, 2),
    contextWindow: config.contextWindow === null ? '' : String(config.contextWindow),
    streamUsage: config.streamUsage,
  };
}

/** What reaching the service takes: enough to read its model list. */
export type ParsedConnection = Pick<ParsedModelForm, 'baseURL' | 'apiKey' | 'headers'>;

export type ConnectionResult =
  | { ok: true; value: ParsedConnection }
  | { ok: false; errors: Pick<ModelFormErrors, 'baseURL' | 'headers'> };

/**
 * Checks only the fields that reach the service (address, key, headers), so
 * the model list can be fetched before a model name is typed.
 */
export function parseConnectionFields(fields: ModelFormFields): ConnectionResult {
  const errors: ModelFormErrors = {};
  const baseURL = checkBaseURL(fields, errors);
  const headers = checkHeaders(fields, errors);
  if (baseURL === null || headers === null || Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value: { baseURL, apiKey: fields.apiKey.trim(), headers } };
}

/**
 * Checks the form before anything is sent, so every error shows next to its
 * field. The background validates again with the contract schemas.
 */
export function parseModelForm(fields: ModelFormFields): ModelFormResult {
  const errors: ModelFormErrors = {};

  const baseURL = checkBaseURL(fields, errors);

  const model = fields.model.trim();
  if (model === '') errors.model = t('model.error.model');

  const menuModels = parseMenuModels(fields.menuModels);
  if (menuModels.length > MAX_MENU_MODELS) {
    errors.menuModels = t('model.error.menuModels', { max: MAX_MENU_MODELS });
  }

  const headers = checkHeaders(fields, errors);

  const extraBody = parseObject(fields.extraBody);
  if (extraBody === null) {
    errors.extraBody = t('model.error.json', { field: t('model.extraBody') });
  } else {
    const reserved = Object.keys(extraBody).find((key) => RESERVED_BODY_KEYS.includes(key));
    if (reserved !== undefined) errors.extraBody = t('model.error.reserved', { name: reserved });
  }

  const contextWindow = parseContextWindow(fields.contextWindow);
  if (contextWindow === undefined) errors.contextWindow = t('model.error.contextWindow');

  if (
    baseURL === null ||
    headers === null ||
    extraBody === null ||
    contextWindow === undefined ||
    Object.keys(errors).length > 0
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      name: fields.name.trim(),
      baseURL,
      apiKey: fields.apiKey.trim(),
      model,
      menuModels,
      headers,
      extraBody,
      contextWindow,
      streamUsage: fields.streamUsage,
    },
  };
}

/** A service's model list as the picker offers it: each id once, in alphabetical order. */
export function modelOptions(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b, 'en'));
}

/** The menu's model names, one per line: trimmed, each once, blank lines left out. */
export function parseMenuModels(text: string): string[] {
  return [...new Set(text.split('\n').map((line) => line.trim()))].filter((name) => name !== '');
}

/**
 * The form as it is saved after its model name changed from `previous`: on
 * the menu's list, the old name gives its place to the new one, so a rename
 * does not leave the old name behind as a menu entry. A list that already has
 * the new name, or never had the old one, stays as the user wrote it.
 */
export function followModelRename(previous: string, form: ParsedModelForm): ParsedModelForm {
  const { model, menuModels } = form;
  if (model === previous || !menuModels.includes(previous) || menuModels.includes(model)) {
    return form;
  }
  return { ...form, menuModels: menuModels.map((name) => (name === previous ? model : name)) };
}

/** `text` with `name` on a new last line, unless a line already has it. */
export function addMenuModel(text: string, name: string): string {
  const names = parseMenuModels(text);
  return names.includes(name) ? names.join('\n') : [...names, name].join('\n');
}

/** The normalized address, or null with its error recorded. */
function checkBaseURL(fields: ModelFormFields, errors: ModelFormErrors): string | null {
  const baseURL = normalizeBaseURL(fields.baseURL);
  if (baseURL.ok) return baseURL.value;
  errors.baseURL = t(`model.error.baseURL.${baseURL.reason}`);
  return null;
}

/** The headers as an object; null when the field is not one (its error recorded). */
function checkHeaders(
  fields: ModelFormFields,
  errors: ModelFormErrors,
): Record<string, string> | null {
  const headers = parseObject(fields.headers);
  if (headers === null) {
    errors.headers = t('model.error.json', { field: t('model.headers') });
    return null;
  }
  const bad = Object.entries(headers).find(([, value]) => typeof value !== 'string');
  if (bad) {
    errors.headers = t('model.error.headers', { name: bad[0] });
    return null;
  }
  const forbidden = Object.keys(headers).find(isForbiddenHeaderName);
  if (forbidden !== undefined) {
    errors.headers = t('model.error.headerForbidden', { name: forbidden });
  }
  return headers as Record<string, string>;
}

/** An empty field means `{}`; anything else must be a JSON object. */
function parseObject(text: string): Record<string, unknown> | null {
  if (text.trim() === '') return {};
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** `null` for an empty field, `undefined` for an invalid one. */
function parseContextWindow(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function isEmpty(value: Record<string, unknown>): boolean {
  return Object.keys(value).length === 0;
}
