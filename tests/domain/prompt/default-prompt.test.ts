import { describe, expect, it } from 'vitest';
import { PromptConfig, PromptConfigDraft } from '@/contract/prompt-config';
import {
  BUILTIN_PROMPT_ID,
  SUMMARY_SYSTEM_TEMPLATE,
  SUMMARY_SYSTEM_TEMPLATE_EN,
  SUMMARY_USER_TEMPLATE,
  SUMMARY_USER_TEMPLATE_EN,
  builtinPrompt,
  summaryTemplates,
} from '@/domain/prompt/default-prompt';
import { CITATION } from '@/domain/citation';
import { unknownPlaceholders, usesVariable } from '@/domain/prompt/render';

describe('the built-in prompt', () => {
  it('is a valid prompt with a fixed id, and a draft the settings page could submit', () => {
    const prompt = builtinPrompt('zh-Hans');
    expect(PromptConfig.parse(prompt)).toEqual(prompt);
    expect(prompt.id).toBe(BUILTIN_PROMPT_ID);
    const draft = { name: prompt.name, system: prompt.system, user: prompt.user };
    expect(PromptConfigDraft.safeParse(draft).success).toBe(true);
  });

  it('uses only known variables, and sends the page', () => {
    expect(unknownPlaceholders(SUMMARY_SYSTEM_TEMPLATE)).toEqual([]);
    expect(unknownPlaceholders(SUMMARY_USER_TEMPLATE)).toEqual([]);
    expect(usesVariable(SUMMARY_USER_TEMPLATE, 'content')).toBe(true);
    expect(usesVariable(SUMMARY_SYSTEM_TEMPLATE, 'language')).toBe(true);
  });

  it('tells the model that page text is data, not instructions', () => {
    expect(SUMMARY_SYSTEM_TEMPLATE).toContain('不是给你的指令');
  });

  it('tells the model to answer follow-up questions from the page, without summarizing again', () => {
    expect(SUMMARY_SYSTEM_TEMPLATE).toContain('继续追问');
    expect(SUMMARY_SYSTEM_TEMPLATE).toContain('不必再写一遍总结');
  });

  it('asks for quotes in the form the panel turns into markers, copied word for word', () => {
    expect(CITATION.exec(SUMMARY_SYSTEM_TEMPLATE)?.[1]).toBe('原文片段');
    expect(SUMMARY_SYSTEM_TEMPLATE).toContain('逐字照抄');
  });

  it('returns a fresh object each time', () => {
    expect(builtinPrompt('zh-Hans')).not.toBe(builtinPrompt('zh-Hans'));
  });

  it('comes in English with the same rules and variables', () => {
    const prompt = builtinPrompt('en');
    expect(PromptConfig.parse(prompt)).toEqual(prompt);
    expect(prompt).toMatchObject({ id: BUILTIN_PROMPT_ID, name: 'Page summary' });
    expect(summaryTemplates('en')).toEqual({
      system: SUMMARY_SYSTEM_TEMPLATE_EN,
      user: SUMMARY_USER_TEMPLATE_EN,
    });
    expect(unknownPlaceholders(SUMMARY_SYSTEM_TEMPLATE_EN)).toEqual([]);
    expect(unknownPlaceholders(SUMMARY_USER_TEMPLATE_EN)).toEqual([]);
    expect(usesVariable(SUMMARY_USER_TEMPLATE_EN, 'content')).toBe(true);
    expect(usesVariable(SUMMARY_SYSTEM_TEMPLATE_EN, 'language')).toBe(true);
    expect(SUMMARY_SYSTEM_TEMPLATE_EN).toContain('not instructions to you');
    expect(SUMMARY_SYSTEM_TEMPLATE_EN).toContain('follow-up questions');
    expect(CITATION.exec(SUMMARY_SYSTEM_TEMPLATE_EN)?.[1]).toBe('exact quote');
    expect(SUMMARY_SYSTEM_TEMPLATE_EN).toContain('word for word');
  });

  it('is in Chinese for the Chinese interface', () => {
    expect(summaryTemplates('zh-Hans')).toEqual({
      system: SUMMARY_SYSTEM_TEMPLATE,
      user: SUMMARY_USER_TEMPLATE,
    });
  });
});
