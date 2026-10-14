import { describe, expect, it } from 'vitest';
import { PromptConfig, PromptConfigDraft, PromptConfigPatch } from '@/contract/prompt-config';

describe('PromptConfig', () => {
  it('fills defaults for fields a stored value lacks, and keeps fields it does not know', () => {
    expect(PromptConfig.parse({ id: 'p', future: 1 })).toEqual({
      id: 'p',
      name: '',
      system: '',
      user: '',
      future: 1,
    });
  });

  it('needs an id', () => {
    expect(PromptConfig.safeParse({ name: 'x' }).success).toBe(false);
  });
});

describe('PromptConfigDraft', () => {
  it('trims the name but keeps the templates exactly as typed', () => {
    expect(PromptConfigDraft.parse({ name: ' 要点 ', user: '\n{{content}}\n' })).toEqual({
      name: '要点',
      system: '',
      user: '\n{{content}}\n',
    });
  });

  it.each([
    ['a blank name', { name: '  ', user: 'u' }],
    ['a blank user template', { name: 'n', user: ' \n ' }],
    ['an id', { id: 'x', name: 'n', user: 'u' }],
  ])('refuses %s', (_label, draft) => {
    expect(PromptConfigDraft.safeParse(draft).success).toBe(false);
  });
});

describe('PromptConfigPatch', () => {
  it('carries no defaults: an empty patch names no fields', () => {
    expect(PromptConfigPatch.parse({})).toEqual({});
    expect(PromptConfigPatch.parse({ system: '' })).toEqual({ system: '' });
  });

  it('refuses a blank user template', () => {
    expect(PromptConfigPatch.safeParse({ user: '  ' }).success).toBe(false);
  });
});
