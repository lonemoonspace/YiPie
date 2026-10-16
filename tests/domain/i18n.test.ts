import { afterEach, describe, expect, it } from 'vitest';
import { locale, setLocale, t } from '@/domain/i18n';
import { setLocale as setBackgroundLocale, t as tBackground } from '@/domain/i18n/background';
import { setLocale as setContentLocale, t as tContent } from '@/domain/i18n/content';
import { en } from '@/domain/i18n/en';
import { background as enBackground } from '@/domain/i18n/en/background';
import { content as enContent } from '@/domain/i18n/en/content';
import { pages as enPages } from '@/domain/i18n/en/pages';
import { htmlLang, resolveLocale } from '@/domain/i18n/locale';
import { zh } from '@/domain/i18n/zh';
import { background } from '@/domain/i18n/zh/background';
import { content } from '@/domain/i18n/zh/content';
import { pages } from '@/domain/i18n/zh/pages';

describe('t', () => {
  it('returns the message for a key', () => {
    expect(t('settings.title')).toBe('设置');
  });

  it('fills named parameters', () => {
    expect(t('error.statusDetail', { status: 401, detail: 'Invalid API key' })).toBe(
      '服务返回 HTTP 401：Invalid API key',
    );
  });

  it('leaves a placeholder visible when its parameter is missing', () => {
    expect(t('settings.loadFailed')).toBe('读取设置失败：{detail}');
  });

  it('does not treat inherited names as parameters', () => {
    expect(t('settings.loadFailed', {})).toContain('{detail}');
    expect(t('model.error.headers', { name: 'toString' })).toBe('请求头的值必须是字符串：toString');
  });
});

describe('message tables by context', () => {
  it('keep each message in exactly one table, and pages carry them all', () => {
    const tables = [background, content, pages].map((table) => Object.keys(table));
    const all = tables.flat();
    expect(new Set(all).size).toBe(all.length);
    expect(Object.keys(zh).sort()).toEqual([...all].sort());
  });

  it('give the service worker and the content script their own few', () => {
    expect(tBackground('host.unavailable')).toBe('此页面无法总结');
    expect(tContent('app.name')).toBe('一瞥');
    // The pages' `t` knows them too.
    expect(t('host.unavailable')).toBe(tBackground('host.unavailable'));
    expect(t('panel.attachFailed')).toBe(tContent('panel.attachFailed'));
  });
});

describe('the English tables', () => {
  afterEach(() => setLocale('zh-Hans'));

  const pairs = [
    ['background', background, enBackground],
    ['content', content, enContent],
    ['pages', pages, enPages],
  ] as const;

  it('have exactly the keys of the Chinese ones, table by table', () => {
    for (const [, chinese, english] of pairs) {
      expect(Object.keys(english).sort()).toEqual(Object.keys(chinese).sort());
    }
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
  });

  it('use the same parameters as the Chinese message for every key', () => {
    const parameters = (text: string) =>
      [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    const chinese: Record<string, string> = zh;
    for (const [key, text] of Object.entries(en)) {
      expect([key, parameters(text)]).toEqual([key, parameters(chinese[key] ?? '')]);
    }
  });

  it('leave no message empty', () => {
    expect(Object.entries(en).filter(([, text]) => text.trim() === '')).toEqual([]);
  });

  it('are what `t` speaks once the language is set, in every context', () => {
    setLocale('en');
    expect(locale()).toBe('en');
    expect(t('settings.title')).toBe('Settings');
    expect(t('error.statusDetail', { status: 401, detail: 'Invalid API key' })).toBe(
      'The service returned HTTP 401: Invalid API key',
    );
    // The service worker and the content script switch on their own.
    expect(tBackground('host.unavailable')).toBe('此页面无法总结');
    setBackgroundLocale('en');
    setContentLocale('en');
    expect(tBackground('host.unavailable')).toBe('This page cannot be summarized');
    expect(tContent('panel.close')).toBe('Close');
    setBackgroundLocale('zh-Hans');
    setContentLocale('zh-Hans');
  });
});

describe('resolveLocale', () => {
  it('follows the browser for auto: Chinese for any Chinese, English otherwise', () => {
    expect(resolveLocale('auto', 'zh-CN')).toBe('zh-Hans');
    expect(resolveLocale('auto', 'zh-TW')).toBe('zh-Hans');
    expect(resolveLocale('auto', 'zh')).toBe('zh-Hans');
    expect(resolveLocale('auto', 'en-US')).toBe('en');
    expect(resolveLocale('auto', 'ja')).toBe('en');
    expect(resolveLocale('auto', '')).toBe('en');
    // Not a Chinese tag, though it starts with the letters.
    expect(resolveLocale('auto', 'zha')).toBe('en');
  });

  it('keeps a language the settings name', () => {
    expect(resolveLocale('en', 'zh-CN')).toBe('en');
    expect(resolveLocale('zh-Hans', 'en-US')).toBe('zh-Hans');
  });

  it('gives pages a lang attribute', () => {
    expect(htmlLang('zh-Hans')).toBe('zh-CN');
    expect(htmlLang('en')).toBe('en');
  });
});
