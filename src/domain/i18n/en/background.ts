import type { background as zh } from '../zh/background';

/** English messages the service worker uses; the same keys as `../zh/background`. */
export const background = {
  'host.unavailable': 'This page cannot be summarized',
  'menu.summarizePage': 'Summarize this page with YiPie',
  'menu.summarizeSelection': 'Summarize the selection with YiPie',
} as const satisfies Record<keyof typeof zh, string>;
