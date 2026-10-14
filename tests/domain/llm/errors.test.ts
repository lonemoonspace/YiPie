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

  it('leaves text alone for empty or very short secrets', () => {
    expect(redact('a b c', ['', 'a'])).toBe('a b c');
  });
});
