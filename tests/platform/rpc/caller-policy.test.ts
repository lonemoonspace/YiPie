import { describe, expect, it } from 'vitest';
import { classifyCaller } from '@/platform/rpc/caller-policy';

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
const page = (path: string, id = EXTENSION_ID) => `chrome-extension://${id}${path}`;

describe('classifyCaller', () => {
  it('recognizes our extension pages by path', () => {
    expect(classifyCaller({ id: EXTENSION_ID, url: page('/options.html') }, EXTENSION_ID)).toBe(
      'options',
    );
    // The panel is an iframe inside a tab, so it carries tab and frame details too.
    expect(
      classifyCaller(
        { id: EXTENSION_ID, url: page('/panel.html'), tab: { id: 3 }, frameId: 12 },
        EXTENSION_ID,
      ),
    ).toBe('panel');
  });

  it('classifies an options page opened in a tab as options, not content', () => {
    expect(
      classifyCaller(
        { id: EXTENSION_ID, url: page('/options.html'), tab: { id: 1 }, frameId: 0 },
        EXTENSION_ID,
      ),
    ).toBe('options');
  });

  it('recognizes a content script in the top frame of a web page', () => {
    expect(
      classifyCaller(
        { id: EXTENSION_ID, url: 'https://example.com/a', tab: { id: 1 }, frameId: 0 },
        EXTENSION_ID,
      ),
    ).toBe('content');
  });

  it.each([
    ['another extension', { id: 'other', url: page('/options.html', 'other') }],
    ['our id but another extension origin', { id: EXTENSION_ID, url: page('/options.html', 'x') }],
    ['an unknown extension page', { id: EXTENSION_ID, url: page('/evil.html') }],
    ['a prototype-looking path', { id: EXTENSION_ID, url: page('/__proto__') }],
    [
      'a content script in a subframe',
      { id: EXTENSION_ID, url: 'https://ads.example/x', tab: { id: 1 }, frameId: 4 },
    ],
    ['a web page without a tab', { id: EXTENSION_ID, url: 'https://example.com/', frameId: 0 }],
    ['a sender without a url', { id: EXTENSION_ID }],
    ['an unparseable url', { id: EXTENSION_ID, url: 'not a url', tab: {}, frameId: 0 }],
  ])('rejects %s', (_label, sender) => {
    expect(classifyCaller(sender, EXTENSION_ID)).toBeNull();
  });
});
