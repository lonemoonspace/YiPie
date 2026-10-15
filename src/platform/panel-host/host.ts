import { browser } from 'wxt/browser';
import { t } from '@/domain/i18n';
import { createLogger } from '@/platform/logger';
import { callRpcLite } from '@/platform/rpc/lite-client';
import { SHELL_CSS } from './shell-css';

const logger = createLogger('host');

const PANEL_PAGE = '/panel.html';
/** Times per minute the host puts itself back after the page removed it, before giving up. */
const REMOUNT_LIMIT = 5;

/**
 * Lives on the isolated world's global object, which every injection into
 * this document shares and the page cannot see. That, and the reference we
 * keep to our own element, is the duplicate-injection guard: we never look the
 * host up in the DOM, so an element the page planted cannot stand in for it.
 */
const INSTANCE_KEY = Symbol.for('yipie.panel-host');

interface PanelHost {
  open(): void;
}

/** Shows the panel in this tab, creating the host on the first call. */
export function openPanelHost(): void {
  const scope = globalThis as unknown as Record<symbol, PanelHost | undefined>;
  const host = (scope[INSTANCE_KEY] ??= createPanelHost());
  host.open();
}

function createPanelHost(): PanelHost {
  // A random tag: page CSS and custom element definitions cannot target it by
  // name. (`crypto.randomUUID` is missing on plain-http pages; this is not.)
  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(4)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  const element = document.createElement(`yipie-panel-${suffix}`);
  pin(element, {
    all: 'initial',
    position: 'fixed',
    top: '16px',
    right: '16px',
    'z-index': '2147483647',
    display: 'block',
    visibility: 'visible',
    opacity: '1',
    transform: 'none',
    'pointer-events': 'auto',
  });

  const shadow = element.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(SHELL_CSS);
  shadow.adoptedStyleSheets = [sheet];

  const frame = node('aside', { class: 'frame', 'aria-label': t('app.name') });
  const bar = node('div', { class: 'bar' });
  const close = node('button', {
    class: 'close',
    type: 'button',
    'aria-label': t('panel.close'),
    title: t('panel.close'),
  });
  close.textContent = '×';
  const title = node('span', { class: 'title' });
  title.textContent = t('app.name');
  const body = node('div', { class: 'body' });
  bar.append(title, close);
  frame.append(bar, body);
  shadow.append(frame);

  let open = false;
  let remounts: number[] = [];

  /** A new panel document needs a new nonce: the old one was presented already. */
  async function mountPanel(): Promise<void> {
    body.replaceChildren();
    try {
      const { nonce } = await callRpcLite('content.hello', {});
      if (!open) return;
      const iframe = document.createElement('iframe');
      // Lets the panel load in pages that send Cross-Origin-Embedder-Policy;
      // set before `src` (docs/development-plan.md appendix F).
      iframe.setAttribute('credentialless', '');
      // The copy button needs clipboard-write. Name the extension's own
      // origin: the default allowlist is the origin of `src`, the per-session
      // dynamic URL, while the panel document commits with the extension's
      // fixed origin, so a bare `clipboard-write` delegates nothing.
      iframe.setAttribute('allow', `clipboard-write chrome-extension://${browser.runtime.id}`);
      iframe.title = t('app.name');
      iframe.src = `${browser.runtime.getURL(PANEL_PAGE)}#${nonce}`;
      body.replaceChildren(iframe);
    } catch (error) {
      logger.warn('Could not mount the panel:', error);
      const message = node('p', { class: 'message', role: 'alert' });
      message.textContent = t('panel.attachFailed');
      body.replaceChildren(message);
    }
  }

  function place(): void {
    const root = document.documentElement;
    root.append(element);
    // Watch for the page removing our host, or replacing <html> altogether.
    observer.observe(document, { childList: true });
    observer.observe(root, { childList: true });
  }

  const observer = new MutationObserver(() => {
    if (!open || element.isConnected) return;
    const now = Date.now();
    remounts = remounts.filter((at) => now - at < 60_000);
    if (remounts.length >= REMOUNT_LIMIT) {
      logger.warn('The page keeps removing the panel; leaving it closed.');
      hide();
      return;
    }
    remounts.push(now);
    place();
    // A removed iframe unloads; putting it back would load a fresh panel.
    void mountPanel();
  });

  function hide(): void {
    open = false;
    observer.disconnect();
    // Removing the frame unloads the panel document, which ends its request.
    body.replaceChildren();
    element.remove();
  }

  close.addEventListener('click', hide);
  makeDraggable(element, bar, frame, close);

  return {
    open() {
      if (open) return;
      open = true;
      place();
      void mountPanel();
    },
  };
}

function makeDraggable(host: HTMLElement, handle: HTMLElement, frame: HTMLElement, skip: Node) {
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target === skip) return;
    const start = host.getBoundingClientRect();
    const offsetX = event.clientX - start.left;
    const offsetY = event.clientY - start.top;
    handle.setPointerCapture(event.pointerId);
    frame.classList.add('dragging');

    const move = (moved: PointerEvent) => {
      const left = clamp(moved.clientX - offsetX, 0, window.innerWidth - host.offsetWidth);
      // Keep the title bar on screen so the panel can always be dragged back.
      const top = clamp(moved.clientY - offsetY, 0, window.innerHeight - handle.offsetHeight);
      pin(host, { left: `${left}px`, top: `${top}px`, right: 'auto' });
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      frame.classList.remove('dragging');
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  });
}

/**
 * Inline `!important` through the CSSOM: it outranks the page's stylesheets,
 * even their `!important` rules, and page CSP does not apply to it.
 */
function pin(element: HTMLElement, declarations: Record<string, string>): void {
  for (const [property, value] of Object.entries(declarations)) {
    element.style.setProperty(property, value, 'important');
  }
}

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string>,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
