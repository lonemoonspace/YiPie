import { Marked } from 'marked';

/**
 * Markdown → HTML for model output, which the panel inserts with
 * `dangerouslySetInnerHTML`. Model output is shaped by the page being
 * summarized, so every branch that could emit markup is an injection point
 * (docs/development-plan.md §8):
 *
 * - raw HTML (block and inline) is escaped, never passed through;
 * - links survive only with an absolute http(s) or mailto target; the target
 *   is escaped and shown on hover, and opens in a new tab without a referrer;
 * - images never become <img>: rendering one would let the page make the
 *   panel fetch a URL of its choosing (and a relative one would hit the site
 *   being summarized). Only the escaped alt text remains;
 * - GFM task-list checkboxes become plain characters, keeping the tag set
 *   small.
 *
 * The extension pages' CSP (`img-src 'self' data:`, `frame-src 'none'`,
 * `form-action 'none'`) is the second line of defence if this ever slips.
 */
const SAFE_TARGET = /^(?:https?:\/\/|mailto:)/i;

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/**
 * Allowlist, not blocklist: a scheme spelled with entities, mixed case or
 * control characters (`&#106;avascript:`, `java\tscript:`) simply does not
 * start with `https://`.
 */
export function isSafeHref(href: string): boolean {
  const target = href.trim();
  // Control characters and whitespace inside a URL only serve to hide a scheme.
  for (const char of target) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f) return false;
  }
  return SAFE_TARGET.test(target);
}

const markdown = new Marked({
  async: false,
  gfm: true,
  breaks: false,
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      if (!isSafeHref(href)) return label;
      const target = escapeHtml(href.trim());
      return `<a href="${target}" title="${target}" target="_blank" rel="noopener noreferrer nofollow">${label}</a>`;
    },
    image({ text }) {
      return escapeHtml(text);
    },
    checkbox({ checked }) {
      return checked ? '☑ ' : '☐ ';
    },
  },
});

export function renderMarkdown(source: string): string {
  return markdown.parse(source, { async: false });
}
