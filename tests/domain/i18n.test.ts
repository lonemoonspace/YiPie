import { describe, expect, it } from 'vitest';
import { t } from '@/domain/i18n';

describe('t', () => {
  it('returns the message for a key', () => {
    expect(t('settings.title')).toBe('设置');
  });

  it('fills named parameters', () => {
    expect(t('error.auth', { status: 401 })).toBe(
      '鉴权失败（HTTP 401）：请检查 API Key 是否正确、是否有权使用这个模型。',
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
