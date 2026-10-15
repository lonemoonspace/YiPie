import { describe, expect, it } from 'vitest';
import { BaseURL } from '@/contract/model-config';
import { BASE_URL_PRESETS } from '@/domain/base-url-presets';
import { normalizeBaseURL } from '@/domain/url';

describe('BASE_URL_PRESETS', () => {
  it('are valid base URLs as the form would store them, each name once', () => {
    for (const { baseURL } of BASE_URL_PRESETS) {
      expect(BaseURL.safeParse(baseURL).success, baseURL).toBe(true);
      expect(normalizeBaseURL(baseURL)).toEqual({ ok: true, value: baseURL });
    }
    const names = BASE_URL_PRESETS.map((preset) => preset.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
