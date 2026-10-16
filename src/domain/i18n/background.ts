import { translator } from './format';
import { background as en } from './en/background';
import { background as zh } from './zh/background';

/**
 * Text for code the service worker runs: it carries only these few messages
 * (docs/development-plan.md §9). The background sets the language once it has
 * read the settings, and again whenever they change.
 */
export const { t, setLocale, locale } = translator({ 'zh-Hans': zh, en });
