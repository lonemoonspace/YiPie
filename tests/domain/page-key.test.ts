import { describe, expect, it } from 'vitest';
import { pageKeyOf } from '@/domain/page-key';

describe('pageKeyOf', () => {
  it.each([
    ['https://example.com/post', 'https://example.com/post'],
    ['https://example.com/post#comments', 'https://example.com/post'],
    ['https://example.com/post#', 'https://example.com/post'],
    ['https://example.com/post?id=7#top', 'https://example.com/post?id=7'],
    ['https://example.com/post#:~:text=quote', 'https://example.com/post'],
  ])('drops the in-page anchor of %s', (url, key) => {
    expect(pageKeyOf(url)).toBe(key);
  });

  it.each([
    ['https://mail.example.com/#/inbox', 'https://mail.example.com/#/inbox'],
    ['https://example.com/app#!/post/1', 'https://example.com/app#!/post/1'],
    ['https://example.com/app#/post/1:~:text=quote', 'https://example.com/app#/post/1'],
  ])('keeps the hash route of %s: it names another page', (url, key) => {
    expect(pageKeyOf(url)).toBe(key);
  });

  it('tells pages with different queries apart', () => {
    expect(pageKeyOf('https://example.com/?p=1')).not.toBe(pageKeyOf('https://example.com/?p=2'));
  });

  it('writes the same page the same way', () => {
    expect(pageKeyOf('HTTPS://Example.COM:443/post#x')).toBe(pageKeyOf('https://example.com/post'));
  });

  it('keeps what it cannot parse as it is', () => {
    expect(pageKeyOf('not a url')).toBe('not a url');
  });
});
