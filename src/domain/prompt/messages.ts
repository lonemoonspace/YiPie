import type { PageContext } from '@/contract/page-context';
import type { PromptConfig } from '@/contract/prompt-config';
import type { ChatMessage } from '@/domain/llm/request';
import { renderTemplate, type PromptValues } from './render';

/** Ends `{{content}}` when the page text was cut, so every prompt tells the model. */
export const TRUNCATION_NOTE = '（正文到这里截断：原文过长，后面的部分没有发送。）';

/**
 * The variables for one page. `selection` stays empty until selection
 * summaries arrive (phase 5); `language` is the language to answer in.
 */
export function promptValues(page: PageContext, language: string): PromptValues {
  return {
    title: page.title,
    url: page.url,
    content: page.truncated ? `${page.text}\n\n${TRUNCATION_NOTE}` : page.text,
    selection: '',
    language,
  };
}

/** The messages for a prompt: a system message unless that template renders blank, then the user message. */
export function buildPromptMessages(
  prompt: Pick<PromptConfig, 'system' | 'user'>,
  values: PromptValues,
): ChatMessage[] {
  const system = renderTemplate(prompt.system, values);
  const user: ChatMessage = { role: 'user', content: renderTemplate(prompt.user, values) };
  return system.trim() === '' ? [user] : [{ role: 'system', content: system }, user];
}
