import type { PageContext } from '@/contract/page-context';
import type { PromptConfig } from '@/contract/prompt-config';
import type { ChatMessage } from '@/domain/llm/request';
import { renderTemplate, type PromptValues } from './render';

// Notes put where page text was cut, so the model knows what it did not get
// (docs/development-plan.md §4.4, decision 4). They are text for the model,
// in the language of the built-in prompt.

/** Ends the text when its end was cut. */
export const TRUNCATION_NOTE = '（正文到这里截断：原文过长，后面的部分没有发送。）';
/** Stands where the middle of the text was cut. */
export const OMISSION_NOTE = '（这里省略了中间的一部分正文：原文过长。）';
/** Starts the text when its beginning was cut. */
export const LATE_START_NOTE = '（前面的一部分正文没有发送：原文过长，这里从中途开始。）';

/**
 * The page text as a prompt gets it. Extraction stops at a fixed length
 * (platform/extract); when it did, the note says so, whatever the prompt.
 */
export function pageContent(page: Pick<PageContext, 'text' | 'truncated'>): string {
  return page.truncated ? `${page.text}\n\n${TRUNCATION_NOTE}` : page.text;
}

/** `<page>` or `</page>` as a model would read it: any case, spaces and attributes allowed. */
const PAGE_TAG = /<(?=\s*\/?\s*page(?:[\s/>]|$))/gi;

/**
 * Text from the page with every `<page>` and `</page>` in it made harmless.
 * The built-in prompt puts the page between those two tags and tells the
 * model that what is between them is data; a page that writes `</page>`
 * itself would end that block early and have the rest read as instructions.
 * Only the opening `<` changes, to the full-width `＜`: the text stays the
 * same length, so the budget is unaffected, and reads the same to a person.
 */
export function neutralizePageTags(text: string): string {
  return text.replace(PAGE_TAG, '＜');
}

/**
 * The variables for one page, with `content` as it will be sent (cut to the
 * budget, notes included): the page text, or the selection when the panel
 * summarizes that (docs/development-plan.md §4.6). `selection` is what was
 * selected when the panel opened; `language` is the language to answer in.
 * Everything that comes from the page goes through `neutralizePageTags`.
 */
export function promptValues(
  page: Pick<PageContext, 'title' | 'url' | 'selection'>,
  content: string,
  language: string,
): PromptValues {
  return {
    title: neutralizePageTags(page.title),
    url: neutralizePageTags(page.url),
    content: neutralizePageTags(content),
    selection: neutralizePageTags(page.selection),
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

/** A message of the conversation so far: an answer, or a question that followed one. */
export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * A whole request: the prompt with the page, the conversation so far, then
 * the new question. The page is rendered afresh for every request rather
 * than stored with the conversation (docs/development-plan.md §4.4, decision
 * 1), so the first answer always follows the page it is about. A summary has
 * no history and no question.
 */
export function conversationMessages(
  prompt: Pick<PromptConfig, 'system' | 'user'>,
  values: PromptValues,
  history: readonly HistoryMessage[],
  question: string | null,
): ChatMessage[] {
  return [
    ...buildPromptMessages(prompt, values),
    ...history.map(({ role, content }) => ({ role, content })),
    ...(question === null ? [] : [{ role: 'user' as const, content: question }]),
  ];
}
