// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { PageContext } from '@/contract/page-context';
import {
  extractPage,
  MAX_LANG_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_URL_LENGTH,
} from '@/platform/extract/readability';
import { textOf, tidy } from '@/platform/extract/text';

function pageWith(body: string, title = '一篇文章', lang = 'zh-CN'): Document {
  const doc = document.implementation.createHTMLDocument(title);
  doc.documentElement.lang = lang;
  doc.body.innerHTML = body;
  return doc;
}

const paragraphs = Array.from(
  { length: 6 },
  (_, i) =>
    `<p>这是第 ${i + 1} 段正文，讲的是一瞥如何在页面里打开面板、提取正文并交给你自己的模型服务来总结，内容足够长。</p>`,
).join('');

describe('extractPage', () => {
  it('keeps the article and its structure, and leaves navigation out', () => {
    const doc = pageWith(
      `<nav><a href="/">首页</a><a href="/about">关于</a></nav>
       <article><h1>一瞥</h1>${paragraphs}<h2>要点</h2><ul><li>第一点</li><li>第二点</li></ul></article>
       <footer>版权所有</footer>`,
    );

    const page = extractPage(doc);

    expect(page.title).toBe('一篇文章');
    expect(page.lang).toBe('zh-CN');
    expect(page.truncated).toBe(false);
    expect(page.text).toContain('这是第 1 段正文');
    expect(page.text).toContain('## 要点');
    expect(page.text).toContain('- 第一点\n\n- 第二点');
    expect(page.text).not.toContain('首页');
    expect(page.text).not.toMatch(/\n{3,}/);
  });

  it('leaves our own panel host out of the text', () => {
    const doc = pageWith(`<article>${paragraphs}</article>`);
    const host = doc.createElement('yipie-panel-0a1b2c3d');
    host.textContent = '面板里的字不该被总结';
    doc.documentElement.append(host);

    expect(extractPage(doc).text).not.toContain('面板里的字');
    // The live document is untouched.
    expect(host.isConnected).toBe(true);
  });

  it('cuts the text at the limit and says so', () => {
    const page = extractPage(pageWith(`<article>${paragraphs}</article>`), 50);
    expect(page.text).toHaveLength(50);
    expect(page.truncated).toBe(true);
  });

  it('keeps a page-written title, address and language within the contract', () => {
    const doc = pageWith(`<article>${paragraphs}</article>`);
    doc.title = '长'.repeat(MAX_TITLE_LENGTH + 500);
    doc.documentElement.lang = 'x'.repeat(MAX_LANG_LENGTH + 50);
    Object.defineProperty(doc, 'URL', {
      value: `https://example.com/?q=${'a'.repeat(MAX_URL_LENGTH)}`,
    });

    const page = extractPage(doc);

    expect(page.title).toHaveLength(MAX_TITLE_LENGTH);
    expect(page.lang).toHaveLength(MAX_LANG_LENGTH);
    expect(page.url).toHaveLength(MAX_URL_LENGTH);
    expect(PageContext.safeParse(page).success).toBe(true);
  });
});

describe('textOf', () => {
  it('breaks lines at blocks and keeps preformatted text as written', () => {
    const container = document.createElement('div');
    container.innerHTML =
      '<p>甲<br>乙</p><pre>  indented\n    code</pre><p>丙 <strong>丁</strong></p>';
    expect(tidy(textOf(container))).toBe('甲\n乙\n\nindented\ncode\n\n丙 丁');
  });

  it('separates table cells so values stay under their headers', () => {
    const container = document.createElement('div');
    container.innerHTML =
      '<table><caption>名单</caption><tr><th>姓名</th><th>年龄</th></tr>' +
      '<tr><td>张三</td><td>30</td></tr><tr><td>李四</td><td></td></tr></table>';
    expect(tidy(textOf(container))).toBe('名单\n\n姓名 | 年龄\n\n张三 | 30\n\n李四 |');
  });
});

describe('tidy', () => {
  it('trims lines, collapses spaces and allows one blank line at most', () => {
    expect(tidy('  a    b \n\n\n\n c\t\n')).toBe('a b\n\nc');
  });
});
