import type { ModelConfig } from '@/contract/model-config';
import { modelsURL } from '@/domain/url';

export interface ModelsRequest {
  url: string;
  headers: Record<string, string>;
}

/**
 * `GET {baseURL}/models`, with the same credentials a chat request carries
 * (docs/development-plan.md §4.6: the settings page tests a connection with
 * it before spending tokens).
 */
export function buildModelsRequest(
  config: Pick<ModelConfig, 'baseURL' | 'apiKey' | 'headers'>,
): ModelsRequest {
  return {
    url: modelsURL(config.baseURL),
    headers: {
      Accept: 'application/json',
      ...(config.apiKey === '' ? {} : { Authorization: `Bearer ${config.apiKey}` }),
      ...config.headers,
    },
  };
}

/**
 * Statuses that mean the service has no model list, rather than that the
 * request was wrong: then only a real chat request can test the connection.
 */
export function isModelListUnsupported(status: number): boolean {
  return status === 404 || status === 405 || status === 501;
}

/**
 * The model ids in a model list: OpenAI's `{ data: [{ id }] }`, which most
 * compatible services copy, or a bare array of the same. Null when the body
 * is not a list at all.
 */
export function parseModelList(body: string): string[] | null {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  const list = Array.isArray(value)
    ? value
    : typeof value === 'object' &&
        value !== null &&
        Array.isArray((value as { data?: unknown }).data)
      ? (value as { data: unknown[] }).data
      : null;
  if (list === null) return null;
  return list.flatMap((entry) => {
    const id = typeof entry === 'string' ? entry : (entry as { id?: unknown } | null)?.id;
    return typeof id === 'string' && id !== '' ? [id] : [];
  });
}
