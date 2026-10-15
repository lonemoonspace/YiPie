import type { content as zh } from '../zh/content';

/** English messages the content script uses; the same keys as `../zh/content`. */
export const content = {
  'app.name': 'YiPie',
  'panel.close': 'Close',
  'panel.attachFailed': 'The panel could not connect to this tab. Click the toolbar icon again.',
} as const satisfies Record<keyof typeof zh, string>;
