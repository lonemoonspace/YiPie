/**
 * Fixture pages served by the local test server. Each one is a situation the
 * panel has to survive (docs/development-plan.md §4.2 acceptance).
 */
export interface FixturePage {
  headers?: Record<string, string>;
  body: string;
}

const article = (title: string, extra = '') => `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>${title}</title></head>
<body>
<header><nav><a href="/">首页</a> · <a href="/about">关于</a></nav></header>
<article>
<h1>${title}</h1>
<p>一瞥是一个浏览器扩展，用你自己配置的 OpenAI 兼容模型服务总结当前网页。</p>
<p>它在页面里打开一个浮动面板，把正文交给模型，再把回答流式显示出来。</p>
<p>The panel runs in an extension frame, so the page cannot read what you type in it.</p>
</article>
${extra}
</body>
</html>`;

/** About 6,000 characters, nearly all CJK: about as many tokens. */
const longArticle = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>一篇很长的文章</title></head>
<body>
<article>
<h1>一篇很长的文章</h1>
${Array.from({ length: 300 }, (_, i) => `<p>第${i + 1}段：一瞥会把正文交给你自己的模型。</p>`).join('\n')}
</article>
</body>
</html>`;

/** The text of `/shadow.html`, which only an open shadow root holds. */
export const SHADOW_TEXT = '这段正文只在组件的 open shadow root 里，页面的 DOM 树上看不到它。';

/** A page whose article a web component draws into an open shadow root. */
const shadowContent = [
  '<h1>组件里的文章</h1>',
  ...Array.from({ length: 4 }, () => `<p>${'一瞥会读到这里的正文。'.repeat(3)}</p>`),
  `<p>${SHADOW_TEXT}</p>`,
].join('');
const shadowArticle = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>组件里的文章</title></head>
<body>
<nav><a href="/">首页</a></nav>
<article-view></article-view>
<script>
customElements.define('article-view', class extends HTMLElement {
  connectedCallback() {
    this.attachShadow({ mode: 'open' }).innerHTML = ${JSON.stringify(shadowContent)};
  }
});
</script>
</body>
</html>`;

export const PAGES: Record<string, FixturePage> = {
  '/shadow.html': { body: shadowArticle },
  '/article.html': { body: article('一篇普通的文章') },
  '/long.html': { body: longArticle },
  '/strict-csp.html': {
    headers: {
      'Content-Security-Policy':
        "default-src 'none'; frame-src 'none'; child-src 'none'; style-src 'none'; img-src 'none'; script-src 'none'",
    },
    body: article('带严格 CSP 的页面'),
  },
  '/coep.html': {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
    body: article('跨源隔离的页面'),
  },
  // Plants elements that look like ours before we ever run.
  '/planted.html': {
    body: article(
      '预先放了同名元素的页面',
      '<yipie-panel id="planted"></yipie-panel><yipie-panel-00000000></yipie-panel-00000000>',
    ),
  },
};

/** A page that embeds our panel by its static URL, as a hostile site might. */
export function embeddingPage(extensionId: string): FixturePage {
  return {
    body: article(
      '自行嵌入面板的页面',
      `<iframe id="forged" src="chrome-extension://${extensionId}/panel.html#forged"></iframe>`,
    ),
  };
}
