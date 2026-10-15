import { describe, expect, it } from 'vitest';
import {
  GeneralSettings,
  GeneralSettingsPatch,
  defaultGeneralSettings,
} from '@/contract/general-settings';

describe('GeneralSettings', () => {
  it('has a default for every field', () => {
    expect(defaultGeneralSettings()).toEqual({
      theme: 'system',
      logLevel: 'info',
      trimming: 'back',
    });
  });

  it('fills the defaults for fields a stored value lacks', () => {
    expect(GeneralSettings.parse({ theme: 'dark' })).toEqual({
      theme: 'dark',
      logLevel: 'info',
      trimming: 'back',
    });
  });

  it('keeps fields it does not know, so an older version never strips them', () => {
    expect(GeneralSettings.parse({ theme: 'dark', fontSize: 'large' })).toMatchObject({
      fontSize: 'large',
    });
  });
});

describe('GeneralSettingsPatch', () => {
  it('carries no defaults: an empty patch names no fields', () => {
    expect(GeneralSettingsPatch.parse({})).toEqual({});
    expect(GeneralSettingsPatch.parse({ theme: 'dark' })).toEqual({ theme: 'dark' });
  });

  it('rejects unknown fields and out-of-range values', () => {
    expect(GeneralSettingsPatch.safeParse({ fontSize: 'large' }).success).toBe(false);
    expect(GeneralSettingsPatch.safeParse({ theme: 'neon' }).success).toBe(false);
    expect(GeneralSettingsPatch.safeParse({ trimming: 'everything' }).success).toBe(false);
  });
});
