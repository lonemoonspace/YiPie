import { RESERVED_BODY_KEYS, type ModelConfig } from '@/contract/model-config';
import { chatCompletionsURL } from '@/domain/url';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/**
 * Builds a streaming chat completions request (docs/development-plan.md §4.2,
 * decision 1). The body carries only what the protocol needs: no
 * `temperature`, no `max_tokens`. OpenAI's reasoning models reject both, while
 * many compatible servers only know `max_tokens`; whoever needs them sets
 * them in `extraBody`, which may also replace `stream_options`.
 */
export function buildChatRequest(
  config: Pick<
    ModelConfig,
    'baseURL' | 'apiKey' | 'model' | 'headers' | 'extraBody' | 'streamUsage'
  >,
  messages: readonly ChatMessage[],
): ChatRequest {
  const extra = Object.fromEntries(
    Object.entries(config.extraBody).filter(([key]) => !RESERVED_BODY_KEYS.includes(key)),
  );

  const body: Record<string, unknown> = {
    ...(config.streamUsage ? { stream_options: { include_usage: true } } : {}),
    ...extra,
    model: config.model,
    messages,
    stream: true,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    ...(config.apiKey === '' ? {} : { Authorization: `Bearer ${config.apiKey}` }),
    // Last, so a service that wants its own auth header can replace ours.
    ...config.headers,
  };

  return { url: chatCompletionsURL(config.baseURL), headers, body };
}

/**
 * Everything in the request that may be a credential, for `redact`: the key;
 * every header value the user set (an `Authorization` override, `X-API-Key`,
 * Azure's `api-key`…) and the token of a `<scheme> <token>` value; and the
 * base URL's user name and password and its query values (`?key=…`, or a bare
 * `?token`), as written and decoded.
 */
export function requestSecrets(
  config: Pick<ModelConfig, 'baseURL' | 'apiKey' | 'headers'>,
): string[] {
  const secrets = [config.apiKey];

  for (const value of Object.values(config.headers)) {
    secrets.push(value);
    const token = /^[A-Za-z][\w.+-]*\s+(\S+)$/.exec(value.trim())?.[1];
    if (token !== undefined) secrets.push(token);
  }

  const url = new URL(config.baseURL);
  for (const raw of [url.username, url.password]) {
    secrets.push(raw, decodeQueryValue(raw));
  }
  for (const pair of url.search.slice(1).split('&')) {
    const raw = pair.slice(pair.indexOf('=') + 1);
    secrets.push(raw, decodeQueryValue(raw));
  }

  return [...new Set(secrets)].filter((secret) => secret !== '');
}

function decodeQueryValue(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    return raw;
  }
}
