// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_FLATTEN_DEPTH, flattenDocument } from '@/platform/extract/flatten';
import { extractText } from '@/platform/extract/readability';

const fixture = (name: string) =>
  readFileSync(path.resolve(import.meta.dirname, '../../fixtures/pages', name), 'utf8');

/** A detached document parsed from a fixture page. */
function load(name: string): Document {
  return new DOMParser().parseFromString(fixture(name), 'text/html');
}

/**
 * Turns each `<template data-shadow-root>` into the open shadow root of its
 * parent, innermost first, as a page's components would at run time.
 */
function attachShadowRoots(root: ParentNode): void {
  for (const template of root.querySelectorAll<HTMLTemplateElement>('template[data-shadow-root]')) {
    attachShadowRoots(template.content);
    const host = template.parentElement;
    template.remove();
    host?.attachShadow({ mode: 'open' }).append(template.content);
  }
}

afterEach(() => {
  document.documentElement.innerHTML = '<head></head><body></body>';
});

describe('extraction pipeline over fixed pages', () => {
  it('article page: the article, with its structure, and nothing around it', () => {
    const page = extractText(load('article.html'));

    expect(page.method).toBe('readability');
    expect(page.title).toBe('一瞥的设计笔记');
    expect(page.lang).toBe('zh-CN');
    expect(page.text).toContain('一瞥把当前网页交给你自己配置的模型服务');
    expect(page.text).toContain('## 为什么不常驻');
    expect(page.text).toContain('- 安装时零站点权限\n\n- 请求不经过中间服务器');
    for (const boilerplate of ['站点首页', '分类一', '相关文章', '版权所有']) {
      expect(page.text).not.toContain(boilerplate);
    }
  });

  it('list page: every item of the list, without the site navigation', () => {
    const page = extractText(load('list.html'));

    expect(page.method).toBe('heuristic');
    expect(page.text).toContain('# 今日新闻');
    expect(page.text).toContain('- 本地模型推理速度再创新高：新一代量化方法让笔记本也能流畅运行。');
    expect(page.text).toContain('- 开源社区发布阅读辅助工具：支持引用定位原文。');
    expect(page.text).not.toContain('科技');
    expect(page.text).not.toContain('订阅');
  });

  it('very short page: the one sentence there is', () => {
    const page = extractText(load('short.html'));

    expect(page.method).toBe('heuristic');
    expect(page.text).toBe('这个页面已经移到新的地址。');
  });

  it('page without content: nothing, so the panel says there is nothing to summarize', () => {
    const page = extractText(load('empty.html'));

    expect(page.text).toBe('');
    expect(page.title).toBe('App');
    expect(page.lang).toBe('en');
  });

  it('content in open shadow roots: expanded, slots filled, nested navigation left out', () => {
    const doc = load('shadow.html');
    attachShadowRoots(doc.body);
    // Not reachable without expanding the shadow roots.
    expect(doc.body.textContent).not.toContain('这段正文写在');

    const page = extractText(doc);

    expect(page.method).toBe('flattened');
    expect(page.text).toContain('这段正文写在 open shadow root 里。');
    expect(page.text).toContain('展开时，slot 的位置换成分配给它的节点：这句话来自宿主的子节点。');
    expect(page.text).not.toContain('站点导航');
  });

  it('content in a same-origin frame: read from the frame', () => {
    document.documentElement.innerHTML = load('iframe.html').documentElement.innerHTML;
    const frame = document.querySelector('iframe')!;
    const inner = frame.contentDocument!;
    inner.open();
    inner.write(fixture('iframe-inner.html'));
    inner.close();

    const page = extractText(document);

    expect(page.method).toBe('flattened');
    expect(page.text).toContain('这段正文在同源的 iframe 里。');
    expect(page.text).not.toContain('首页');
  });
});

describe('flattenDocument', () => {
  it('stops at the depth limit', () => {
    const doc = document.implementation.createHTMLDocument('深');
    let host: Element = doc.body;
    for (let level = 0; level <= MAX_FLATTEN_DEPTH + 1; level += 1) {
      const next = doc.createElement('div');
      next.textContent = `第 ${level} 层`;
      const root = host === doc.body ? doc.body : host.attachShadow({ mode: 'open' });
      root.append(next);
      host = next;
    }

    const { doc: flat, expanded } = flattenDocument(doc);

    expect(expanded).toBe(MAX_FLATTEN_DEPTH);
    expect(flat.body.textContent).toContain(`第 ${MAX_FLATTEN_DEPTH} 层`);
    expect(flat.body.textContent).not.toContain(`第 ${MAX_FLATTEN_DEPTH + 1} 层`);
  });

  it('leaves closed shadow roots and our own host out', () => {
    const doc = document.implementation.createHTMLDocument('封闭');
    const closed = doc.createElement('div');
    closed.attachShadow({ mode: 'closed' }).textContent = '封闭的影子树';
    const ours = doc.createElement('yipie-panel-0a1b2c3d');
    ours.textContent = '面板';
    doc.body.append(closed, ours);

    const { doc: flat, expanded } = flattenDocument(doc);

    expect(expanded).toBe(0);
    expect(flat.body.textContent).toBe('');
  });
});
