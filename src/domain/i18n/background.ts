import { translator } from './format';
import { background } from './zh/background';

/**
 * Text for code the service worker runs: it carries only these few messages
 * (docs/development-plan.md §9).
 */
export const t = translator(background);
