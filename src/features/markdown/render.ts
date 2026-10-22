import { Marked, type Tokens } from 'marked';
import { CITATION } from '@/domain/citation';
import { t } from '@/domain/i18n';

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
 *   small;
 * - a quote of the page, `[[passage]]` (domain/citation), becomes a numbered
 *   button that finds the passage in the page. It is recognised only where
 *   inline text is parsed: in code, in raw HTML (escaped) and in link targets
 *   it stays the characters it was, and inside a link's text it is plain
 *   text, since a button cannot sit inside a link. The passage is escaped
 *   into its attributes.
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

/** A quote of the page in model output. */
interface CitationToken extends Tokens.Generic {
  type: 'citation';
  raw: string;
  passage: string;
}

const LEADING_CITATION = new RegExp(`^${CITATION.source}`);

/**
 * A parser for one render: `quotes` numbers that answer's quotes, in order,
 * so no state is shared between renders.
 */
const createMarkdown = () => {
  let quotes = 0;
  return new Marked({
    async: false,
    gfm: true,
    breaks: false,
    extensions: [
      {
        name: 'citation',
        level: 'inline',
        start: (source: string) => {
          const at = source.indexOf('[[');
          return at === -1 ? undefined : at;
        },
        tokenizer: (source: string): CitationToken | undefined => {
          const match = LEADING_CITATION.exec(source);
          const passage = match?.[1]?.trim();
          if (match === null || !passage) return undefined;
          return { type: 'citation', raw: match[0], passage };
        },
        renderer: (token) => {
          quotes += 1;
          const passage = escapeHtml((token as CitationToken).passage);
          const label = escapeHtml(t('panel.cite.label', { number: quotes }));
          return `<button type="button" class="cite" data-quote="${passage}" aria-label="${label}">${quotes}</button>`;
        },
      },
    ],
    renderer: {
      html({ text }) {
        return escapeHtml(text);
      },
      link({ href, tokens }) {
        const label = this.parser.parseInline(tokens.map(plainQuote));
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
};

/** A quote inside a link's text, as the plain text it was. */
function plainQuote(token: Tokens.Generic): Tokens.Generic {
  return token.type === 'citation' ? { type: 'text', raw: token.raw, text: token.raw } : token;
}

export function renderMarkdown(source: string): string {
  return createMarkdown().parse(source, { async: false });
}
