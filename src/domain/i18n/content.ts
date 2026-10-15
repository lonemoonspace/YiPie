import { translator } from './format';
import { content } from './zh/content';

/**
 * Text for the content script: it carries only these few messages
 * (docs/development-plan.md §9).
 */
export const t = translator(content);
