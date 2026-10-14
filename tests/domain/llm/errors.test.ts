import { describe, expect, it } from 'vitest';
import {
  describeErrorBody,
  fromFetchFailure,
  fromHttpStatus,
  fromStreamError,
  redact,
} from '@/domain/llm/errors';

describe('fromHttpStatus', () => {
  it('treats 401 and 403 as authentication failures', () => {
    expect(fromHttpStatus(401, '{"error":{"message":"Invalid API key"}}')).toEqual({
      kind: 'auth',
      status: 401,
      detail: 'Invalid API key',
    });
    expect(fromHttpStatus(403, '').kind).toBe('auth');
  });

  it('keeps every other status as http with the service message', () => {
    expect(fromHttpStatus(404, '{"error":{"message":"model not found"}}')).toEqual({
      kind: 'http',
      status: 404,
      detail: 'model not found',
    });
    expect(fromHttpStatus(500, 'Internal Server Error').kind).toBe('http');
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
  it('keeps the message', () => {
    expect(fromStreamError('overloaded')).toEqual({ kind: 'stream', detail: 'overloaded' });
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
