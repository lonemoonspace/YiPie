import { describe, expect, it } from 'vitest';
import { t } from '@/domain/i18n';
import { t as tBackground } from '@/domain/i18n/background';
import { t as tContent } from '@/domain/i18n/content';
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
