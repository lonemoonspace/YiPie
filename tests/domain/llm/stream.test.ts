import { describe, expect, it } from 'vitest';
import { createThinkSplitter, interpretEventData, type Sorted } from '@/domain/llm/stream';

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
      { type: 'finish', reason: 'stop' },
    ]);
  });

  it('ignores usage: null, which some servers send on every chunk', () => {
    expect(
      interpretEventData(JSON.stringify({ choices: [{ delta: { content: 'a' } }], usage: null })),
    ).toEqual([{ type: 'content', text: 'a' }]);
  });

  it('reads reasoning apart from the answer, whichever field carries it', () => {
    const chunk = (delta: object) => JSON.stringify({ choices: [{ delta }] });
    // DeepSeek and vLLM
    expect(interpretEventData(chunk({ reasoning_content: '先想', content: null }))).toEqual([
      { type: 'reasoning', text: '先想' },
    ]);
    // OpenRouter and Ollama
    expect(interpretEventData(chunk({ reasoning: 'hmm' }))).toEqual([
      { type: 'reasoning', text: 'hmm' },
    ]);
    // Both, as some proxies send them: the same text, once.
    expect(interpretEventData(chunk({ reasoning_content: 'x', reasoning: 'x' }))).toEqual([
      { type: 'reasoning', text: 'x' },
    ]);
    // The last piece of reasoning and the first of the answer, in one chunk.
    expect(interpretEventData(chunk({ reasoning_content: '想完了', content: '答案' }))).toEqual([
      { type: 'reasoning', text: '想完了' },
      { type: 'content', text: '答案' },
    ]);
    expect(interpretEventData(chunk({ reasoning_content: null, content: '答' }))).toEqual([
      { type: 'content', text: '答' },
    ]);
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

describe('createThinkSplitter', () => {
  /** Feeds `pieces` through one splitter and joins what comes out. */
  function sort(pieces: string[]): Sorted {
    const splitter = createThinkSplitter();
    const out: Sorted = { reasoning: '', answer: '' };
    for (const sorted of [...pieces.map((piece) => splitter.push(piece)), splitter.flush()]) {
      out.reasoning += sorted.reasoning;
      out.answer += sorted.answer;
    }
    return out;
  }

  it('sorts reasoning at the start out of the answer', () => {
    expect(sort(['<think>\n先想一想\n</think>\n\n## 概要\n正文'])).toEqual({
      reasoning: '\n先想一想\n',
      answer: '## 概要\n正文',
    });
    expect(sort(['  \n<think>想</think>答'])).toEqual({ reasoning: '想', answer: '答' });
  });

  it('finds the tags wherever the stream splits them', () => {
    const text = '<think>思考</think>\n答案';
    for (let at = 1; at < text.length; at += 1) {
      expect(sort([text.slice(0, at), text.slice(at)])).toEqual({
        reasoning: '思考',
        answer: '答案',
      });
    }
    expect(sort([...text])).toEqual({ reasoning: '思考', answer: '答案' });
  });

  it('leaves an answer without reasoning as it is, a tag of its own included', () => {
    expect(sort(['普通的回答'])).toEqual({ reasoning: '', answer: '普通的回答' });
    expect(sort(['<', 'b>粗体</b>'])).toEqual({ reasoning: '', answer: '<b>粗体</b>' });
    expect(sort(['先说结论。<think>这不是推理</think>'])).toEqual({
      reasoning: '',
      answer: '先说结论。<think>这不是推理</think>',
    });
  });

  it('keeps what it held when the stream ends early', () => {
    expect(sort(['<think>想到一半'])).toEqual({ reasoning: '想到一半', answer: '' });
    expect(sort(['<think>想', '</thi'])).toEqual({ reasoning: '想</thi', answer: '' });
    expect(sort(['<thi'])).toEqual({ reasoning: '', answer: '<thi' });
  });

  it('gives each piece out as soon as it can', () => {
    const splitter = createThinkSplitter();
    expect(splitter.push('<think>想')).toEqual({ reasoning: '想', answer: '' });
    expect(splitter.push('法</')).toEqual({ reasoning: '法', answer: '' });
    expect(splitter.push('think>\n')).toEqual({ reasoning: '', answer: '' });
    expect(splitter.push('答')).toEqual({ reasoning: '', answer: '答' });
    expect(splitter.push('案')).toEqual({ reasoning: '', answer: '案' });
  });
});
