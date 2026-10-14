import { describe, expect, it } from 'vitest';
import { buildChatRequest, type ChatMessage } from '@/domain/llm/request';

const messages: ChatMessage[] = [
  { role: 'system', content: 'Summarize.' },
  { role: 'user', content: 'Page text' },
];

const config = {
  baseURL: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-test',
  headers: {},
  extraBody: {},
  streamUsage: true,
};

describe('buildChatRequest', () => {
  it('sends only what the protocol needs', () => {
    const request = buildChatRequest(config, messages);

    expect(request.url).toBe('https://api.example.com/v1/chat/completions');
    expect(request.body).toEqual({
      model: 'gpt-test',
      messages,
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(request.body).not.toHaveProperty('temperature');
    expect(request.body).not.toHaveProperty('max_tokens');
  });

  it('asks for stream usage only when configured to', () => {
    expect(buildChatRequest({ ...config, streamUsage: false }, messages).body).not.toHaveProperty(
      'stream_options',
    );
  });

  it('merges extraBody, but never over model, messages or stream', () => {
    const request = buildChatRequest(
      {
        ...config,
        extraBody: {
          temperature: 0.2,
          max_tokens: 512,
          model: 'other-model',
          messages: [],
          stream: false,
          stream_options: { include_usage: false },
        },
      },
      messages,
    );

    expect(request.body).toEqual({
      model: 'gpt-test',
      messages,
      stream: true,
      temperature: 0.2,
      max_tokens: 512,
      stream_options: { include_usage: false },
    });
  });

  it('authenticates with the key and adds the user headers last', () => {
    const request = buildChatRequest(
      { ...config, headers: { 'HTTP-Referer': 'https://me.example', 'X-Title': 'YiPie' } },
      messages,
    );

    expect(request.headers).toEqual({
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: 'Bearer sk-test',
      'HTTP-Referer': 'https://me.example',
      'X-Title': 'YiPie',
    });
  });

  it('sends no Authorization header without a key, and lets headers replace it', () => {
    expect(buildChatRequest({ ...config, apiKey: '' }, messages).headers).not.toHaveProperty(
      'Authorization',
    );
    expect(
      buildChatRequest({ ...config, headers: { Authorization: 'Token abc' } }, messages).headers
        .Authorization,
    ).toBe('Token abc');
  });
});
