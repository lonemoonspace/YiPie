import { translator } from './format';
import { content as en } from './en/content';
import { content as zh } from './zh/content';

/**
 * Text for the content script: it carries only these few messages
 * (docs/development-plan.md §9). It learns the language from the background
 * when it mounts the panel (`content.hello`).
 */
export const { t, setLocale } = translator({ 'zh-Hans': zh, en });
