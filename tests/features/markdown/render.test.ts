// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { escapeHtml, isSafeHref, renderMarkdown } from '@/features/markdown/render';

const ALLOWED_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'strong',
  'em',
  'del',
  'code',
  'pre',
  'blockquote',
  'a',
  'hr',
  'br',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
]);
const ALLOWED_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(['href', 'title', 'target', 'rel']),
  code: new Set(['class']),
  ol: new Set(['start']),
  th: new Set(['align']),
  td: new Set(['align']),
};

/** Parses the output the way the panel would and checks it against the allowlists. */
function render(markdown: string) {
  const container = document.createElement('div');
  container.innerHTML = renderMarkdown(markdown);
  const elements = [...container.querySelectorAll('*')];
  for (const element of elements) {
    const tag = element.tagName.toLowerCase();
    expect(ALLOWED_TAGS, `unexpected <${tag}>`).toContain(tag);
    for (const attribute of element.getAttributeNames()) {
      expect(ALLOWED_ATTRIBUTES[tag]?.has(attribute), `unexpected ${tag}[${attribute}]`).toBe(true);
    }
  }
  for (const link of container.querySelectorAll('a')) {
    expect(link.getAttribute('href')).toMatch(/^(?:https?:\/\/|mailto:)/i);
    expect(link.getAttribute('rel')).toBe('noopener noreferrer nofollow');
    expect(link.getAttribute('target')).toBe('_blank');
  }
  return { container, links: [...container.querySelectorAll('a')], text: container.textContent };
}

describe('renderMarkdown', () => {
  it('renders ordinary Markdown', () => {
    const { container } = render(
      [
        '## 概要',
        '',
        '这是 **重点** 和 *强调*，以及 `code`。',
        '',
        '- 要点一',
        '- 要点二',
        '',
        '1. 第一',
        '2. 第二',
        '',
        '> 引用',
        '',
        '| 列 | 值 |',
        '| --- | ---: |',
        '| a | 1 |',
        '',
        '```js',
        'console.log("<b>")',
        '```',
      ].join('\n'),
    );

    expect(container.querySelector('h2')?.textContent).toBe('概要');
    expect(container.querySelectorAll('li')).toHaveLength(4);
    expect(container.querySelector('strong')?.textContent).toBe('重点');
    expect(container.querySelector('td[align="right"]')?.textContent).toBe('1');
    expect(container.querySelector('pre code')?.textContent).toBe('console.log("<b>")\n');
  });

  it('escapes raw HTML instead of passing it through', () => {
    const { container, text } = render(
      '<script>alert(1)</script>\n\n<b onclick="steal()">bold</b> and <img src=x onerror=alert(1)>',
    );
    expect(container.querySelector('script, b, img')).toBeNull();
    expect(text).toContain('<script>alert(1)</script>');
    expect(text).toContain('<img src=x onerror=alert(1)>');
  });

  it('keeps safe links, opens them in a new tab, and shows the real target on hover', () => {
    const { links } = render(
      '[官网](https://example.com/a?b=1&c=2) <https://auto.example/x> <me@example.com> https://bare.example/y',
    );
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://example.com/a?b=1&c=2',
      'https://auto.example/x',
      'mailto:me@example.com',
      'https://bare.example/y',
    ]);
    expect(links[0]?.getAttribute('title')).toBe('https://example.com/a?b=1&c=2');
    expect(links[0]?.textContent).toBe('官网');
  });

  it.each([
    ['javascript:', '[x](javascript:alert(1))'],
    ['mixed-case javascript:', '[x](JaVaScRiPt:alert(1))'],
    ['entity-encoded javascript:', '[x](&#106;avascript:alert(1))'],
    ['hex-entity javascript:', '[x](java&#x73;cript:alert(1))'],
    ['named-entity colon', '[x](javascript&colon;alert(1))'],
    ['data:', '[x](data:text/html,<script>alert(1)</script>)'],
    ['vbscript:', '[x](vbscript:msgbox(1))'],
    ['file:', '[x](file:///etc/passwd)'],
    ['a relative path', '[x](/settings)'],
    ['a protocol-relative URL', '[x](//evil.example/x)'],
  ])('drops a %s link but keeps its text', (_label, markdown) => {
    const { links, text } = render(markdown);
    expect(links).toHaveLength(0);
    expect(text).toContain('x');
  });

  it('never renders an image, only its escaped alt text', () => {
    const { container, text } = render(
      '![公司标志](https://evil.example/pixel.png) ![<img src=x onerror=alert(1)>](javascript:alert(1))',
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(text).toContain('公司标志');
    expect(text).toContain('<img src=x onerror=alert(1)>');
  });

  it('keeps a quote in a link target inside the attribute', () => {
    const { links } = render('[x](https://example.com/"onmouseover="alert(1))');
    for (const link of links) {
      expect(link.getAttributeNames()).not.toContain('onmouseover');
    }
  });

  it('turns task-list checkboxes into characters', () => {
    const { container, text } = render('- [x] 完成\n- [ ] 未完成');
    expect(container.querySelector('input')).toBeNull();
    expect(text).toContain('☑ 完成');
    expect(text).toContain('☐ 未完成');
  });
});

describe('isSafeHref', () => {
  it.each([
    ['https://example.com', true],
    ['HTTP://EXAMPLE.COM', true],
    ['mailto:a@b.c', true],
    ['  https://example.com  ', true],
    ['https://exa mple.com', false],
    ['java\tscript:alert(1)', false],
    ['https:\u0000//x', false],
    ['ftp://example.com', false],
  ])('%j → %s', (href, safe) => {
    expect(isSafeHref(href)).toBe(safe);
  });
});

describe('escapeHtml', () => {
  it('escapes the five characters that matter in HTML text and attributes', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });
});
