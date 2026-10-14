import type { PageContext } from '@/contract/page-context';
import type { ChatMessage } from '@/domain/llm/request';
import { renderTemplate, type PromptValues } from './render';

/** Appended to `{{content}}` when the page text was cut to fit. */
export const TRUNCATED_NOTE = '（正文过长，以上只是开头部分）';

/**
 * What a page supplies to a template. `{{language}}` is the language the page
 * declares (`<html lang>`), possibly empty; `{{selection}}` arrives with
 * selection summaries in phase 5 and is empty until then.
 */
export function pageValues(page: PageContext): PromptValues {
  return {
    title: page.title,
    url: page.url,
    content: page.truncated ? `${page.text}\n\n${TRUNCATED_NOTE}` : page.text,
    selection: '',
    language: page.lang,
  };
}

export interface PromptTemplates {
  system: string;
  user: string;
}

/** The messages for one prompt and one page. A blank system template sends no system message. */
export function buildPromptMessages(prompt: PromptTemplates, page: PageContext): ChatMessage[] {
  const values = pageValues(page);
  const system = renderTemplate(prompt.system, values).text;
  const user: ChatMessage = { role: 'user', content: renderTemplate(prompt.user, values).text };
  return system.trim() === '' ? [user] : [{ role: 'system', content: system }, user];
}
