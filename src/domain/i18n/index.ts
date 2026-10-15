import { translator } from './format';
import { zh } from './zh';

export type { MessageParams } from './format';

export type MessageKey = keyof typeof zh;

/** Every table for another language must have exactly these keys. */
export type Messages = Record<MessageKey, string>;

/**
 * Text for extension pages: the panel and the settings page, which carry
 * every message. Code the service worker or the content script runs uses
 * `@/domain/i18n/background` or `@/domain/i18n/content` instead (§9).
 */
export const t = translator<MessageKey>(zh);
