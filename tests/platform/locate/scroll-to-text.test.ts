// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { QUOTE_HIGHLIGHT, locateQuote } from '@/platform/locate/scroll-to-text';

function pageWith(body: string): Document {
  const doc = document.implementation.createHTMLDocument('页面');
  doc.body.innerHTML = body;
  return doc;
}

/** A stand-in for `CSS.highlights` and `Highlight`, which jsdom lacks. */
function fakeHighlights() {
  const registry = new Map<string, Range>();
  return {
    registry,
    api: {
      highlights: {
        set: (name: string, highlight: unknown) => registry.set(name, highlight as Range),
        delete: (name: string) => registry.delete(name),
      },
      create: (range: Range) => range,
    },
  };
}

describe('locateQuote', () => {
  it('finds a passage across elements and highlights exactly it, without touching the DOM', () => {
    const doc = pageWith(
      '<p>一瞥在页面里打开<strong>一个浮动面板</strong>，把正文交给模型。</p><script>var x = "浮动面板";</script>',
    );
    const before = doc.body.innerHTML;
    const { registry, api } = fakeHighlights();

    expect(locateQuote(doc, '打开 一个浮动面板', api)).toBe(true);

    expect(registry.get(QUOTE_HIGHLIGHT)?.toString()).toBe('打开一个浮动面板');
    expect(doc.body.innerHTML).toBe(before);
  });

  it('tolerates whitespace the model wrote differently', () => {
    const doc = pageWith('<p>The panel   runs in an\n extension frame.</p>');
    const { registry, api } = fakeHighlights();

    expect(locateQuote(doc, 'panel runs in an extension', api)).toBe(true);
    expect(registry.get(QUOTE_HIGHLIGHT)?.toString()).toBe('panel   runs in an\n extension');
  });

  it('reports a passage the page does not have, and clears the previous highlight', () => {
    const doc = pageWith('<p>一瞥是一个浏览器扩展。</p>');
    const { registry, api } = fakeHighlights();
    locateQuote(doc, '浏览器扩展', api);

    expect(locateQuote(doc, '一个网站', api)).toBe(false);
    expect(registry.has(QUOTE_HIGHLIGHT)).toBe(false);
  });

  it('scrolls the passage into view', () => {
    const doc = pageWith('<p>前文</p><p id="target">要找的这一句</p>');
    const scroll = vi.fn();
    (doc.getElementById('target') as HTMLElement).scrollIntoView = scroll;

    locateQuote(doc, '要找的这一句', fakeHighlights().api);

    expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
  });

  it('skips scripts, form fields and our own host', () => {
    const doc = pageWith(
      '<script>var a = "隐藏的话"</script><textarea>隐藏的话</textarea><yipie-panel-0a1b2c3d>隐藏的话</yipie-panel-0a1b2c3d>',
    );
    expect(locateQuote(doc, '隐藏的话', fakeHighlights().api)).toBe(false);
  });

  it('still finds the passage where the browser has no highlight API', () => {
    expect(locateQuote(pageWith('<p>一句话</p>'), '一句话', null)).toBe(true);
  });
});
