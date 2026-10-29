import { describe, expect, it } from 'vitest';
import {
  chatCompletionsURL,
  isInjectableURL,
  isLocalOrigin,
  withOriginsOnly,
  normalizeBaseURL,
  originPattern,
} from '@/domain/url';

describe('normalizeBaseURL', () => {
  it.each([
    ['https://api.openai.com/v1', 'https://api.openai.com/v1'],
    ['  https://api.openai.com/v1/  ', 'https://api.openai.com/v1'],
    ['https://api.openai.com/v1/chat/completions', 'https://api.openai.com/v1'],
    ['https://api.openai.com/v1/chat/completions/', 'https://api.openai.com/v1'],
    ['http://localhost:11434/v1', 'http://localhost:11434/v1'],
    ['http://localhost:11434', 'http://localhost:11434'],
    ['http://localhost:11434/', 'http://localhost:11434'],
    [
      'https://gw.example.com/openai/v1?api-version=2024-10-21',
      'https://gw.example.com/openai/v1?api-version=2024-10-21',
    ],
    ['https://api.example.com/v1#section', 'https://api.example.com/v1'],
  ])('tidies %s', (input, expected) => {
    expect(normalizeBaseURL(input)).toEqual({ ok: true, value: expected });
  });

  it('does not guess a missing /v1', () => {
    expect(normalizeBaseURL('https://api.deepseek.com')).toEqual({
      ok: true,
      value: 'https://api.deepseek.com',
    });
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['localhost:11434/v1', 'protocol'],
    ['api.openai.com/v1', 'invalid'],
    ['ftp://example.com/v1', 'protocol'],
    ['javascript:alert(1)', 'protocol'],
  ])('rejects %j as %s', (input, reason) => {
    expect(normalizeBaseURL(input)).toEqual({ ok: false, reason });
  });
});

describe('chatCompletionsURL', () => {
  it('appends the endpoint path before any query', () => {
    expect(chatCompletionsURL('https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1/chat/completions',
    );
    expect(chatCompletionsURL('http://localhost:11434')).toBe(
      'http://localhost:11434/chat/completions',
    );
    expect(chatCompletionsURL('https://gw.example.com/v1?api-version=1')).toBe(
      'https://gw.example.com/v1/chat/completions?api-version=1',
    );
  });
});

describe('originPattern', () => {
  it('names exactly the configured origin, port included', () => {
    expect(originPattern('https://api.openai.com/v1')).toBe('https://api.openai.com/*');
    expect(originPattern('http://localhost:11434/v1')).toBe('http://localhost:11434/*');
    expect(originPattern('https://api.example.com:8443/v1?x=1')).toBe(
      'https://api.example.com:8443/*',
    );
  });
});

describe('isInjectableURL', () => {
  it.each([
    'https://example.com/article',
    'http://127.0.0.1:8080/page',
    'https://chrome.google.com/search',
    'https://example.com/papers/pdf-tools.html',
    'https://example.com/report.pdf.html',
  ])('accepts the web page %s', (url) => {
    expect(isInjectableURL(url)).toBe(true);
  });

  it.each([
    undefined,
    '',
    'chrome://settings',
    'edge://extensions',
    'chrome-extension://abc/options.html',
    'about:blank',
    'file:///home/me/notes.html',
    'view-source:https://example.com',
    'data:text/html,hi',
    'https://chromewebstore.google.com/detail/xyz',
    'https://chrome.google.com/webstore/detail/xyz',
    'https://microsoftedge.microsoft.com/addons/detail/xyz',
    'chrome-search://local-ntp/local-ntp.html',
    'devtools://devtools/bundled/inspector.html',
    'blob:https://example.com/0f3c',
    // The built-in PDF viewer
    'https://arxiv.org/pdf/2401.00001.pdf',
    'https://example.com/files/Report.PDF?download=1',
  ])('refuses %s', (url) => {
    expect(isInjectableURL(url)).toBe(false);
  });
});

describe('withOriginsOnly', () => {
  it('cuts each address in a message to its origin', () => {
    expect(
      withOriginsOnly(
        'Cannot access contents of url "https://site.example/path?token=abc". Extension manifest must request permission',
      ),
    ).toBe(
      'Cannot access contents of url "https://site.example". Extension manifest must request permission',
    );
    expect(withOriginsOnly('at file:///home/u/secret.html and data:x')).toBe('at <url> and data:x');
    expect(withOriginsOnly('no address here')).toBe('no address here');
  });
});

describe('isLocalOrigin', () => {
  it.each([
    'http://localhost:11434',
    'http://127.0.0.1:8080',
    'http://127.1.2.3',
    'http://[::1]:11434',
    'http://ollama.localhost',
  ])('takes %s for this machine', (origin) => {
    expect(isLocalOrigin(origin)).toBe(true);
  });

  it.each(['https://api.openai.com', 'http://192.168.1.10:11434', 'http://localhost.example.com'])(
    'does not take %s for this machine',
    (origin) => {
      expect(isLocalOrigin(origin)).toBe(false);
    },
  );

  it('takes nothing it cannot parse for this machine', () => {
    expect(isLocalOrigin('not an origin')).toBe(false);
  });
});
