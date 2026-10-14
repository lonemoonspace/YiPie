import type { ModelConfig } from '@/contract/model-config';
import { t } from '@/domain/i18n';
import { normalizeBaseURL } from '@/domain/url';

/** The model form as the user typed it: every field is text, except the checkbox. */
export interface ModelFormFields {
  name: string;
  baseURL: string;
  apiKey: string;
  model: string;
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
    headers: isEmpty(config.headers) ? '' : JSON.stringify(config.headers, null, 2),
    extraBody: isEmpty(config.extraBody) ? '' : JSON.stringify(config.extraBody, null, 2),
    contextWindow: config.contextWindow === null ? '' : String(config.contextWindow),
    streamUsage: config.streamUsage,
  };
}

/**
 * Checks the form before anything is sent, so every error shows next to its
 * field. The background validates again with the contract schemas.
 */
export function parseModelForm(fields: ModelFormFields): ModelFormResult {
  const errors: ModelFormErrors = {};

  const baseURL = normalizeBaseURL(fields.baseURL);
  if (!baseURL.ok) errors.baseURL = t(`model.error.baseURL.${baseURL.reason}`);

  const model = fields.model.trim();
  if (model === '') errors.model = t('model.error.model');

  const headers = parseObject(fields.headers);
  if (headers === null) {
    errors.headers = t('model.error.json', { field: t('model.headers') });
  } else {
    const bad = Object.entries(headers).find(([, value]) => typeof value !== 'string');
    if (bad) errors.headers = t('model.error.headers', { name: bad[0] });
  }

  const extraBody = parseObject(fields.extraBody);
  if (extraBody === null) {
    errors.extraBody = t('model.error.json', { field: t('model.extraBody') });
  }

  const contextWindow = parseContextWindow(fields.contextWindow);
  if (contextWindow === undefined) errors.contextWindow = t('model.error.contextWindow');

  if (
    !baseURL.ok ||
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
      baseURL: baseURL.value,
      apiKey: fields.apiKey.trim(),
      model,
      headers: headers as Record<string, string>,
      extraBody,
      contextWindow,
      streamUsage: fields.streamUsage,
    },
  };
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
