import { describe, expect, it } from 'vitest';
import { chatCompletionsURL, isInjectableURL, normalizeBaseURL, originPattern } from '@/domain/url';

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
  ])('refuses %s', (url) => {
    expect(isInjectableURL(url)).toBe(false);
  });
});
