import { describe, expect, it } from 'vitest';
import {
  adviceFor,
  automaticRetryWait,
  DEFAULT_RETRY_WAIT,
  describeErrorBody,
  fromFetchFailure,
  fromHttpStatus,
  fromProtocolError,
  fromStreamError,
  isLocalOriginRefusal,
  MAX_RETRY_WAIT,
  parseRetryAfter,
  redact,
  type LlmError,
  type LlmErrorKind,
} from '@/domain/llm/errors';

describe('fromHttpStatus', () => {
  // §4.5 acceptance: each of these has its own assertion.
  it('treats 401 and 403 as authentication failures', () => {
    expect(fromHttpStatus(401, '{"error":{"message":"Invalid API key"}}')).toEqual({
      kind: 'auth',
      status: 401,
      detail: 'Invalid API key',
    });
    expect(fromHttpStatus(403, '')).toEqual({ kind: 'auth', status: 403, detail: '' });
  });

  it('treats 404 as a model or endpoint that does not exist', () => {
    expect(
      fromHttpStatus(
        404,
        '{"error":{"message":"The model `gpt-9` does not exist or you do not have access to it.","code":"model_not_found"}}',
      ),
    ).toEqual({
      kind: 'not-found',
      status: 404,
      detail: 'The model `gpt-9` does not exist or you do not have access to it.',
    });
    expect(fromHttpStatus(404, '<html><body><h1>404 Not Found</h1></body></html>').kind).toBe(
      'not-found',
    );
  });

  it('treats 429 as a rate limit, with how long the service asked to wait', () => {
    expect(
      fromHttpStatus(429, '{"error":{"message":"Rate limit reached for requests"}}', '7'),
    ).toEqual({
      kind: 'rate-limit',
      status: 429,
      detail: 'Rate limit reached for requests',
      retryAfter: 7,
    });
  });

  it.each([
    [
      429,
      '{"error":{"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota","code":"insufficient_quota"}}',
    ],
    [402, '{"error":{"message":"Insufficient Balance","type":"unknown_error"}}'],
    [
      402,
      '{"error":{"message":"Insufficient credits. Add more using https://openrouter.ai/credits"}}',
    ],
  ])('treats running out of money as quota, not as a rate limit (%i)', (status, body) => {
    expect(fromHttpStatus(status, body).kind).toBe('quota');
  });

  it.each([500, 502, 503, 504, 529])('treats %i as a server error', (status) => {
    expect(fromHttpStatus(status, 'Bad Gateway')).toMatchObject({ kind: 'server', status });
  });

  it.each([
    [
      400,
      '{"error":{"message":"This model\'s maximum context length is 128000 tokens. However, your messages resulted in 130512 tokens.","type":"invalid_request_error","code":"context_length_exceeded"}}',
    ],
    [400, '{"error":{"message":"Request too large","code":"context_length_exceeded"}}'],
    [400, '{"error":{"message":"prompt is too long: 210000 tokens > 200000 maximum"}}'],
    [
      400,
      '{"error":{"message":"The input token count (1200000) exceeds the maximum number of tokens allowed (1048576)."}}',
    ],
    [422, '{"detail":"Input is too long for the context window of this model."}'],
    [413, '<html><body><h1>413 Request Entity Too Large</h1></body></html>'],
  ])('recognizes a refusal for context length (%i)', (status, body) => {
    expect(fromHttpStatus(status, body).kind).toBe('context-length');
  });

  it('does not take a rate limit or another bad request for context length', () => {
    expect(
      fromHttpStatus(
        429,
        '{"error":{"message":"Rate limit reached on tokens per min; context length"}}',
      ).kind,
    ).toBe('rate-limit');
    expect(fromHttpStatus(400, '{"error":{"message":"max_tokens is too large: 99999"}}')).toEqual({
      kind: 'bad-request',
      status: 400,
      detail: 'max_tokens is too large: 99999',
    });
  });

  it('notes a refusal of stream_options, however the service words it', () => {
    for (const body of [
      '{"error":{"message":"Unrecognized request argument supplied: stream_options"}}',
      '{"detail":[{"type":"extra_forbidden","loc":["body","stream_options"],"msg":"Extra inputs are not permitted"}]}',
      'unknown field `include_usage`',
    ]) {
      expect(fromHttpStatus(400, body)).toMatchObject({
        kind: 'bad-request',
        streamOptionsRejected: true,
      });
    }
    expect(fromHttpStatus(422, 'stream_options: extra fields not permitted')).toMatchObject({
      streamOptionsRejected: true,
    });
    expect(fromHttpStatus(400, 'invalid model')).not.toHaveProperty('streamOptionsRejected');
    // Only a bad request is such a refusal.
    expect(fromHttpStatus(500, 'stream_options')).not.toHaveProperty('streamOptionsRejected');
  });

  it('treats 408 as a timeout and any other status as unknown', () => {
    expect(fromHttpStatus(408, '').kind).toBe('timeout');
    expect(fromHttpStatus(405, 'Method Not Allowed')).toEqual({
      kind: 'unknown',
      status: 405,
      detail: 'Method Not Allowed',
    });
  });
});

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-10-15T08:00:00Z');

  it('reads seconds, or a date', () => {
    expect(parseRetryAfter('5', now)).toBe(5);
    expect(parseRetryAfter(' 1.5 ', now)).toBe(1.5);
    expect(parseRetryAfter('Thu, 15 Oct 2026 08:00:30 GMT', now)).toBe(30);
    expect(parseRetryAfter('Thu, 15 Oct 2026 07:59:00 GMT', now)).toBe(0);
  });

  it('gives nothing for a missing or unreadable value', () => {
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter('', now)).toBeNull();
    expect(parseRetryAfter('soon', now)).toBeNull();
    expect(parseRetryAfter('-3', now)).toBeNull();
  });
});

describe('automaticRetryWait', () => {
  const error = (kind: LlmErrorKind, retryAfter?: number): LlmError =>
    retryAfter === undefined ? { kind, detail: '' } : { kind, detail: '', retryAfter };

  it('retries rate limits, server errors and network failures, after the wait the service asks', () => {
    expect(automaticRetryWait(error('rate-limit', 3))).toBe(3);
    expect(automaticRetryWait(error('rate-limit'))).toBe(DEFAULT_RETRY_WAIT);
    expect(automaticRetryWait(error('server'))).toBe(DEFAULT_RETRY_WAIT);
    expect(automaticRetryWait(error('server', 0))).toBe(0);
    expect(automaticRetryWait(error('network'))).toBe(DEFAULT_RETRY_WAIT);
  });

  it('does not wait longer than 10 s: a longer wait is left to the user', () => {
    expect(automaticRetryWait(error('rate-limit', MAX_RETRY_WAIT))).toBe(MAX_RETRY_WAIT);
    expect(automaticRetryWait(error('rate-limit', MAX_RETRY_WAIT + 1))).toBeNull();
  });

  it.each([
    'auth',
    'unauthorized-access',
    'quota',
    'context-length',
    'bad-request',
    'not-found',
    'timeout',
    'aborted',
    'unknown',
  ] as const)('never retries %s on its own', (kind) => {
    expect(automaticRetryWait(error(kind))).toBeNull();
  });
});

describe('adviceFor', () => {
  it('points to the settings where the fix lies, and offers a retry where waiting may help', () => {
    expect(adviceFor('auth')).toEqual({ retry: false, settings: true });
    expect(adviceFor('not-found')).toEqual({ retry: false, settings: true });
    expect(adviceFor('rate-limit')).toEqual({ retry: true, settings: false });
    expect(adviceFor('server')).toEqual({ retry: true, settings: false });
    expect(adviceFor('aborted')).toEqual({ retry: false, settings: false });
  });
});

describe('isLocalOriginRefusal', () => {
  const refused: LlmError = { kind: 'auth', status: 403, detail: '' };

  it('recognizes a local server refusing an extension, as Ollama does', () => {
    expect(isLocalOriginRefusal(refused, 'http://localhost:11434')).toBe(true);
    expect(isLocalOriginRefusal(refused, 'http://127.0.0.1:11434')).toBe(true);
  });

  it('does not blame the origin for a remote 403 or a local 401', () => {
    expect(isLocalOriginRefusal(refused, 'https://api.openai.com')).toBe(false);
    expect(isLocalOriginRefusal({ ...refused, status: 401 }, 'http://localhost:11434')).toBe(false);
  });
});

describe('fromFetchFailure', () => {
  const base = {
    aborted: false,
    timedOut: false,
    hasOriginPermission: true,
    message: 'Failed to fetch',
  };

  it('tells a user stop from a timeout from a network failure', () => {
    expect(fromFetchFailure({ ...base, aborted: true }).kind).toBe('aborted');
    expect(fromFetchFailure({ ...base, timedOut: true }).kind).toBe('timeout');
    expect(fromFetchFailure(base)).toEqual({ kind: 'network', detail: 'Failed to fetch' });
  });

  it('blames the missing host permission when we do not hold it', () => {
    expect(fromFetchFailure({ ...base, hasOriginPermission: false }).kind).toBe(
      'unauthorized-access',
    );
    expect(fromFetchFailure({ ...base, hasOriginPermission: null }).kind).toBe('network');
  });
});

describe('fromStreamError', () => {
  it('goes by the code a failure in the stream carries', () => {
    expect(fromStreamError({ message: 'Provider returned error', status: 502 })).toEqual({
      kind: 'server',
      status: 502,
      detail: 'Provider returned error',
    });
    expect(fromStreamError({ message: 'slow down', status: 429 }).kind).toBe('rate-limit');
  });

  it('goes by its words when it carries no code, and blames the service otherwise', () => {
    expect(fromStreamError({ message: 'overloaded' })).toEqual({
      kind: 'server',
      detail: 'overloaded',
    });
    expect(fromStreamError({ message: 'x', type: 'rate_limit_exceeded' }).kind).toBe('rate-limit');
    expect(fromStreamError({ message: 'x', type: 'insufficient_quota' }).kind).toBe('quota');
    expect(fromStreamError({ message: 'x', type: 'invalid_request_error' }).kind).toBe(
      'bad-request',
    );
    expect(fromStreamError({ message: 'Invalid API key', type: 'authentication_error' }).kind).toBe(
      'auth',
    );
  });

  it('recognizes a context-length failure reported inside the stream', () => {
    expect(
      fromStreamError({
        message: "This model's maximum context length is 8192 tokens.",
        type: 'invalid_request_error',
      }).kind,
    ).toBe('context-length');
  });
});

describe('fromProtocolError', () => {
  it('reports data that breaks the protocol as unknown, with what arrived', () => {
    expect(fromProtocolError('The service sent data that is not JSON: <html>')).toEqual({
      kind: 'unknown',
      detail: 'The service sent data that is not JSON: <html>',
    });
  });
});

describe('describeErrorBody', () => {
  it.each([
    ['{"error":{"message":"bad key","type":"invalid_request_error"}}', 'bad key'],
    ['{"error":"plain error"}', 'plain error'],
    ['{"message":"from message"}', 'from message'],
    ['{"detail":"from FastAPI"}', 'from FastAPI'],
    ['{"error":{"code":42}}', '{"error":{"code":42}}'],
    ['  upstream timed out  ', 'upstream timed out'],
    [
      '<html><head><title>502</title><style>p{}</style></head><body><h1>502 Bad Gateway</h1><script>x()</script></body></html>',
      '502 502 Bad Gateway',
    ],
    ['', ''],
  ])('summarizes %j', (body, expected) => {
    expect(describeErrorBody(body)).toBe(expected);
  });

  it('clips long bodies', () => {
    expect(describeErrorBody('x'.repeat(1000))).toHaveLength(301);
  });
});

describe('redact', () => {
  it('replaces every occurrence of each secret', () => {
    expect(redact('Incorrect API key provided: sk-abcdef; sk-abcdef again', ['sk-abcdef'])).toBe(
      'Incorrect API key provided: ***; *** again',
    );
  });

  it('replaces a short secret too, wherever it stands alone', () => {
    expect(redact('Incorrect API key provided: abc', ['abc'])).toBe(
      'Incorrect API key provided: ***',
    );
    expect(redact("key 'abc' (abc) key=abc; Bearer abc", ['abc'])).toBe(
      "key '***' (***) key=***; Bearer ***",
    );
    // Services that write Chinese put no space around it.
    expect(redact('密钥abc无效', ['abc'])).toBe('密钥***无效');
    expect(redact('x', ['x'])).toBe('***');
  });

  it('leaves other words alone around a short secret', () => {
    expect(redact('max_tokens exceeded for text x', ['x'])).toBe(
      'max_tokens exceeded for text ***',
    );
    expect(redact('model gpt-4o-2024-11-20 not found', ['1'])).toBe(
      'model gpt-4o-2024-11-20 not found',
    );
    expect(redact('abcdef xabc', ['abc'])).toBe('abcdef xabc');
  });

  it('replaces a long secret even inside other text', () => {
    expect(redact('token=sk-abcdefgh&x / Xsk-abcdefghY', ['sk-abcdefgh'])).toBe(
      'token=***&x / X***Y',
    );
  });

  it('treats a secret as literal text, not a pattern', () => {
    expect(redact('a.c abc a+c', ['a.c', 'a+c'])).toBe('*** abc ***');
  });

  it('replaces the longest secret first, and ignores empty ones', () => {
    expect(redact('Bearer sk-abcdefgh-2', ['', 'sk-abcdefgh', 'Bearer sk-abcdefgh-2'])).toBe('***');
    expect(redact('a b c', [''])).toBe('a b c');
  });
});
