export type BaseURLResult =
  { ok: true; value: string } | { ok: false; reason: 'empty' | 'invalid' | 'protocol' };

/**
 * Tidies a base URL as typed or pasted: trims it, drops trailing slashes and a
 * pasted `/chat/completions`, and drops the fragment. Query parameters stay
 * (some gateways need one, such as `api-version`).
 *
 * It does not add `/v1`: not every service uses it, so guessing would turn a
 * correct URL into a wrong one (docs/development-plan.md appendix D).
 */
export function normalizeBaseURL(input: string): BaseURLResult {
  const trimmed = input.trim();
  if (trimmed === '') return { ok: false, reason: 'empty' };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'protocol' };
  }

  return { ok: true, value: `${url.origin}${basePath(url.pathname)}${url.search}` };
}

/** The chat completions endpoint under a (normalized) base URL. */
export function chatCompletionsURL(baseURL: string): string {
  const url = new URL(baseURL);
  return `${url.origin}${basePath(url.pathname)}/chat/completions${url.search}`;
}

/** `GET {baseURL}/models`: the model list, which the settings page's connection test reads. */
export function modelsURL(baseURL: string): string {
  const url = new URL(baseURL);
  return `${url.origin}${basePath(url.pathname)}/models${url.search}`;
}

function basePath(pathname: string): string {
  return pathname
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/, '')
    .replace(/\/+$/, '');
}

/**
 * The host permission pattern for a base URL's origin, port included, as
 * `permissions.request` expects it. We ask for exactly the origin the user
 * configured, nothing wider (docs/development-plan.md appendix C).
 */
export function originPattern(baseURL: string): string {
  const url = new URL(baseURL);
  return `${url.protocol}//${url.host}/*`;
}

/** Hosts whose pages Chrome and Edge never let an extension script. */
const STORE_HOSTS = new Set(['chromewebstore.google.com', 'microsoftedge.microsoft.com']);

/**
 * Whether we may inject into a tab showing `url` (docs/development-plan.md
 * §4.5, decision 5). Only ordinary `http(s)` web pages qualify. Not browser
 * pages (`chrome://`, `edge://`, `chrome-search://`, `devtools://`), other
 * extensions (`chrome-extension://`), `view-source:`, `about:`, `data:`,
 * `blob:`, `file:`; not the extension stores, which no extension may script;
 * not a PDF, which the browser shows in its own viewer at the file's URL.
 * Only a path that ends in `.pdf` tells; a PDF without one is injected, and
 * the panel finds no text in it.
 */
export function isInjectableURL(url: string | undefined): boolean {
  if (url === undefined) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (STORE_HOSTS.has(parsed.hostname)) return false;
  if (parsed.hostname === 'chrome.google.com' && parsed.pathname.startsWith('/webstore')) {
    return false;
  }
  return !/\.pdf$/i.test(parsed.pathname);
}

/**
 * Whether `origin` is this machine, where a local model server such as Ollama
 * runs: `localhost` (and its subdomains), 127.0.0.0/8 or `[::1]`.
 */
export function isLocalOrigin(origin: string): boolean {
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  return (
    host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || /^127\./.test(host)
  );
}

/**
 * `text` with every web address in it cut to its origin: for logging a
 * browser message that quotes a page URL, whose path and query may carry a
 * token (AGENTS.md, credentials and logs).
 */
export function withOriginsOnly(text: string): string {
  return text.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]*/gi, (address) => {
    try {
      const { origin } = new URL(address);
      return origin === 'null' ? '<url>' : origin;
    } catch {
      return '<url>';
    }
  });
}
