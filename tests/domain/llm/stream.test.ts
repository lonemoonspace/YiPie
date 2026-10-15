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

  it('reports an error sent inside the stream, with its code and type', () => {
    expect(
      interpretEventData(
        JSON.stringify({ error: { message: 'Upstream overloaded', type: 'server_error' } }),
      ),
    ).toEqual([
      { type: 'error', failure: { message: 'Upstream overloaded', type: 'server_error' } },
    ]);
    expect(interpretEventData(JSON.stringify({ error: 'boom' }))).toEqual([
      { type: 'error', failure: { message: 'boom' } },
    ]);
    // OpenRouter sends the upstream status as a number, others as a string.
    expect(
      interpretEventData(
        JSON.stringify({ error: { code: 502, message: 'Provider returned error' } }),
      ),
    ).toEqual([{ type: 'error', failure: { message: 'Provider returned error', status: 502 } }]);
    expect(
      interpretEventData(
        JSON.stringify({ error: { code: 'insufficient_quota', status: '429', message: 'quota' } }),
      ),
    ).toEqual([
      { type: 'error', failure: { message: 'quota', status: 429, type: 'insufficient_quota' } },
    ]);
  });

  it('reports an event named error, whatever its data', () => {
    expect(
      interpretEventData(
        JSON.stringify({ type: 'overloaded_error', message: 'Overloaded' }),
        'error',
      ),
    ).toEqual([{ type: 'error', failure: { message: 'Overloaded', type: 'overloaded_error' } }]);
    expect(interpretEventData('upstream went away', 'error')).toEqual([
      { type: 'error', failure: { message: 'upstream went away' } },
    ]);
  });

  it('reports data that is not a JSON object as breaking the protocol', () => {
    expect(interpretEventData('not json')).toEqual([
      { type: 'invalid', message: 'The service sent data that is not JSON: not json' },
    ]);
    expect(interpretEventData('[1,2]')[0]?.type).toBe('invalid');
  });
});
