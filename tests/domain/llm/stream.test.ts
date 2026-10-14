import { describe, expect, it } from 'vitest';
import { interpretEventData } from '@/domain/llm/stream';

const delta = (content: unknown) => JSON.stringify({ choices: [{ index: 0, delta: { content } }] });

describe('interpretEventData', () => {
  it('reads a content delta', () => {
    expect(interpretEventData(delta('你好'))).toEqual([{ type: 'content', text: '你好' }]);
  });

  it('skips deltas without text: the role-only first chunk, null and empty content', () => {
    expect(
      interpretEventData(JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] })),
    ).toEqual([]);
    expect(interpretEventData(delta(null))).toEqual([]);
    expect(interpretEventData(delta(''))).toEqual([]);
    expect(interpretEventData('')).toEqual([]);
  });

  it('marks the end of the stream', () => {
    expect(interpretEventData('[DONE]')).toEqual([{ type: 'done' }]);
    expect(interpretEventData(' [DONE] ')).toEqual([{ type: 'done' }]);
  });

  it('reads usage from a trailing chunk with no choices', () => {
    const chunk = JSON.stringify({
      choices: [],
      usage: {
        prompt_tokens: 1200,
        completion_tokens: 300,
        total_tokens: 1500,
        prompt_tokens_details: { cached_tokens: 1024 },
      },
    });
    expect(interpretEventData(chunk)).toEqual([
      { type: 'usage', usage: { promptTokens: 1200, completionTokens: 300, totalTokens: 1500 } },
    ]);
  });

  it('reads usage attached to the last content chunk', () => {
    const chunk = JSON.stringify({
      choices: [{ delta: { content: '。' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    });
    expect(interpretEventData(chunk)).toEqual([
      { type: 'content', text: '。' },
      { type: 'usage', usage: { promptTokens: 10, completionTokens: 2, totalTokens: null } },
    ]);
  });

  it('ignores usage: null, which some servers send on every chunk', () => {
    expect(
      interpretEventData(JSON.stringify({ choices: [{ delta: { content: 'a' } }], usage: null })),
    ).toEqual([{ type: 'content', text: 'a' }]);
  });

  it('keeps reasoning out of the answer', () => {
    const chunk = JSON.stringify({
      choices: [{ delta: { reasoning_content: 'Let me think', reasoning: 'hmm', content: null } }],
    });
    expect(interpretEventData(chunk)).toEqual([]);
  });

  it('reports an error sent inside the stream', () => {
    expect(
      interpretEventData(
        JSON.stringify({ error: { message: 'Upstream overloaded', type: 'server_error' } }),
      ),
    ).toEqual([{ type: 'error', message: 'Upstream overloaded' }]);
    expect(interpretEventData(JSON.stringify({ error: 'boom' }))).toEqual([
      { type: 'error', message: 'boom' },
    ]);
  });

  it('reports data that is not a JSON object', () => {
    expect(interpretEventData('not json')).toEqual([
      { type: 'error', message: 'The service sent data that is not JSON: not json' },
    ]);
    expect(interpretEventData('[1,2]')[0]?.type).toBe('error');
  });
});
