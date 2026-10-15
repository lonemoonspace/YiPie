import { background } from './background';
import { content } from './content';
import { pages } from './pages';

/**
 * Every Chinese message, as extension pages carry them. Split by the context
 * that uses it, so the service worker and the content script load only their
 * own few (docs/development-plan.md §9). The English tables in `../en` have
 * the same keys (§4.7).
 */
export const zh = { ...background, ...content, ...pages };
