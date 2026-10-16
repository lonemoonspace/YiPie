import { background } from './background';
import { content } from './content';
import { pages } from './pages';

/** Every English message, as extension pages carry them; the same keys as `../zh`. */
export const en = { ...background, ...content, ...pages };
