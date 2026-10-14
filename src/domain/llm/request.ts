import type { ModelConfig } from '@/contract/model-config';
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

/** Body fields the protocol needs; `extraBody` cannot override them. */
export const RESERVED_BODY_KEYS: readonly string[] = ['model', 'messages', 'stream'];

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
