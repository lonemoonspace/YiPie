import { describe, expect, it } from 'vitest';
import { ItemId, MoveInput, updateInput } from '@/contract/mutations';
import { PromptConfig, PromptConfigDraft, PromptConfigPatch } from '@/contract/prompt-config';
import { Selection, defaultSelection } from '@/contract/selection';

describe('PromptConfig', () => {
  it('fills defaults and keeps fields it does not know', () => {
    expect(PromptConfig.parse({ id: 'p', name: '总结', user: '{{content}}', future: 1 })).toEqual({
      id: 'p',
      name: '总结',
      system: '',
      user: '{{content}}',
      future: 1,
    });
  });

  it.each([
    ['a blank name', { name: '  ' }],
    ['a blank user template', { user: '\n' }],
    ['a missing id', { id: '' }],
  ])('rejects %s', (_label, override) => {
    expect(
      PromptConfig.safeParse({ id: 'p', name: '总结', user: '{{content}}', ...override }).success,
    ).toBe(false);
  });
});

describe('PromptConfigDraft and PromptConfigPatch', () => {
  it('a draft refuses an id; a patch carries no defaults', () => {
    expect(PromptConfigDraft.safeParse({ id: 'x', name: 'n', user: 'u' }).success).toBe(false);
    expect(PromptConfigPatch.parse({})).toEqual({});
    expect(PromptConfigPatch.parse({ system: '' })).toEqual({ system: '' });
  });
});

describe('Selection', () => {
  it('has no defaults until something is chosen, and keeps unknown fields', () => {
    expect(defaultSelection()).toEqual({ defaultModelId: null, defaultPromptId: null });
    expect(Selection.parse({ defaultModelId: 'm', later: true })).toEqual({
      defaultModelId: 'm',
      defaultPromptId: null,
      later: true,
    });
  });
});

describe('mutation inputs', () => {
  it('name an item by a bounded id', () => {
    expect(ItemId.safeParse('').success).toBe(false);
    expect(ItemId.safeParse('x'.repeat(101)).success).toBe(false);
  });

  it('move takes a non-negative whole position', () => {
    expect(MoveInput.safeParse({ id: 'a', to: 0 }).success).toBe(true);
    expect(MoveInput.safeParse({ id: 'a', to: -1 }).success).toBe(false);
    expect(MoveInput.safeParse({ id: 'a', to: 1.5 }).success).toBe(false);
  });

  it('update wraps a patch schema, refusing unknown fields', () => {
    const UpdatePrompt = updateInput(PromptConfigPatch);
    expect(UpdatePrompt.parse({ id: 'a', patch: { name: 'n' } })).toEqual({
      id: 'a',
      patch: { name: 'n' },
    });
    expect(UpdatePrompt.safeParse({ id: 'a', patch: {}, extra: 1 }).success).toBe(false);
  });
});
