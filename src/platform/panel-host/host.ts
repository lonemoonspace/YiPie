import { browser } from 'wxt/browser';
import { PANEL_ATTACH_FAILED, type PanelMode } from '@/contract/rpc-wire';
import { setLocale, t } from '@/domain/i18n/content';
import { pageKeyOf } from '@/domain/page-key';
import { clearQuoteHighlight } from '@/platform/locate/scroll-to-text';
import { createLogger } from '@/platform/logger';
import { callRpcLite } from '@/platform/rpc/lite-client';
import {
  HOST_MARKER,
  HOST_TAG_PREFIX,
  isOrphaned,
  removeLeftoverHosts,
  watchForOrphaning,
} from './orphan';
import { createLogo } from './logo';
import { SHELL_CSS } from './shell-css';

const logger = createLogger('host');

const PANEL_PAGE = '/panel.html';
/** Times per minute the host puts itself back after the page removed it, before giving up. */
const REMOUNT_LIMIT = 5;
/**
 * Times per minute the host removes a leftover host again. A host of the
 * previous version puts itself back up to five times before it gives up;
 * a page that keeps putting one back is left alone after this many.
 */
const LEFTOVER_LIMIT = 10;

/**
 * Lives on the isolated world's global object, which every injection into
 * this document shares and the page cannot see. That, and the reference we
 * keep to our own element, is the duplicate-injection guard: we never look up
 * our host in the DOM, so an element the page planted cannot stand in for it.
 */
const INSTANCE_KEY = Symbol.for('yipie.panel-host');

interface PanelHost {
  /** `triggeredOn`: the page the trigger was on, as the background saw it; null when unknown. */
  open(mode: PanelMode, triggeredOn: string | null): void;
}

/** The host, and the runtime of the extension that created it. */
interface Instance {
  runtime: unknown;
  host: PanelHost;
}

/**
 * Shows the panel in this tab, creating the host on the first call. A panel
 * of the page already open stays as it is when the page is asked for again.
 * Anything else is new work, so a new panel replaces the open one: a summary
 * of the selection, or the page while the selection's panel is open.
 */
export function openPanelHost(mode: PanelMode = 'page', triggeredOn: string | null = null): void {
  const scope = globalThis as unknown as Record<symbol, Instance | undefined>;
  let instance = scope[INSTANCE_KEY];
  // Left by an older version of the extension, should it share this world:
  // dead, so a new host replaces it (orphan.ts).
  if (instance?.runtime !== browser.runtime) {
    instance = { runtime: browser.runtime, host: createPanelHost() };
    scope[INSTANCE_KEY] = instance;
  }
  instance.host.open(mode, triggeredOn);
}

function createPanelHost(): PanelHost {
  // A random tag: page CSS and custom element definitions cannot target it by
  // name. (`crypto.randomUUID` is missing on plain-http pages; this is not.)
  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(4)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  const element = document.createElement(`${HOST_TAG_PREFIX}${suffix}`);
  // What a later version looks for before it removes this host (orphan.ts).
  element.setAttribute(HOST_MARKER, '');
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

  const frame = node('aside', { class: 'frame' });
  const bar = node('div', { class: 'bar' });
  const close = node('button', { class: 'close', type: 'button' });
  close.textContent = '×';
  // The brand at the left end of the bar is what the panel is dragged by.
  const brand = node('div', { class: 'brand' });
  const title = node('span', { class: 'title' });
  brand.append(createLogo(), title);
  /** Words of the shell, in the interface language of the moment. */
  function label(): void {
    frame.setAttribute('aria-label', t('app.name'));
    close.setAttribute('aria-label', t('panel.close'));
    close.title = t('panel.close');
    title.textContent = t('app.name');
  }
  label();
  const body = node('div', { class: 'body' });
  bar.append(brand, close);
  frame.append(bar, body);
  shadow.append(frame);

  let open = false;
  /** The latest mount could not attach: the next trigger mounts again. */
  let failed = false;
  /** The frame of the latest mount, the only window whose word about attaching counts. */
  let mounted: HTMLIFrameElement | null = null;
  /** The panel in our frame could not attach (#22): its own page says so. */
  const onMessage = (event: MessageEvent) => {
    if (event.data !== PANEL_ATTACH_FAILED) return;
    if (mounted === null || event.source !== mounted.contentWindow) return;
    failed = true;
  };
  /** What the mounted panel works on, as the latest trigger asked. */
  let mode: PanelMode = 'page';
  /** The page the latest trigger was on. */
  let trigger: string | null = null;
  /** Counts mounts: only the latest one puts a frame in. */
  let mounts = 0;
  let remounts: number[] = [];
  let leftovers: number[] = [];

  /** Removes the hosts an older version left, as often as `LEFTOVER_LIMIT` allows. */
  function clearLeftovers(): void {
    const now = Date.now();
    leftovers = leftovers.filter((at) => now - at < 60_000);
    if (leftovers.length >= LEFTOVER_LIMIT) return;
    if (removeLeftoverHosts(element) > 0) leftovers.push(now);
  }
  /** The page the background bound the mounted panel to; null until it says. */
  let page: string | null = null;

  /**
   * The panel belongs to the page it was opened on: its conversation is about
   * that page and saved under it. When the document becomes another page
   * without loading (a single-page app's `pushState` or `replaceState`, a
   * hash route, back and forward between them), the panel closes, as it does
   * when a page loads (docs/development-plan.md §4.4, detail 12). A jump to
   * an anchor is the same page.
   */
  function closeIfAnotherPage(): boolean {
    if (!open || page === null || pageKeyOf(location.href) === page) return false;
    hide();
    return true;
  }
  navigation.addEventListener('currententrychange', closeIfAnotherPage);

  /** A new panel document needs a new nonce: the old one was presented already. */
  async function mountPanel(): Promise<void> {
    const mount = ++mounts;
    failed = false;
    mounted = null;
    body.replaceChildren();
    page = null;
    try {
      const { nonce, pageKey, theme, locale } = await callRpcLite('content.hello', { mode });
      // Closed, or mounted afresh, while we asked: that mount's nonce is the one.
      if (!open || mount !== mounts) return;
      // The shell wears the panel's theme (shell-css.ts) and speaks its language.
      frame.dataset.theme = theme;
      setLocale(locale);
      label();
      // The document may have become another page while we asked.
      page = pageKey;
      if (closeIfAnotherPage()) return;
      // Or before: a selection is about the page it was made on, and the
      // panel would bind it to this one (#29).
      if (mode === 'selection' && trigger !== null && trigger !== pageKey) {
        hide();
        return;
      }
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
      mounted = iframe;
    } catch (error) {
      // The extension was updated or reloaded: a new injection takes over.
      if (isOrphaned()) {
        hide();
        return;
      }
      if (mount !== mounts) return;
      logger.warn('Could not mount the panel:', error);
      // Fail closed means the next request tries again (AGENTS.md): a trigger
      // on a panel that never attached mounts afresh instead of being ignored.
      failed = true;
      const message = node('p', { class: 'message', role: 'alert' });
      message.textContent = t('panel.attachFailed');
      body.replaceChildren(message);
    }
  }

  function place(): void {
    const root = document.documentElement;
    root.append(element);
    // A host an older version left in the page would sit under ours.
    clearLeftovers();
    // Watch for the page removing our host, or replacing <html> altogether.
    observer.observe(document, { childList: true });
    observer.observe(root, { childList: true });
    window.addEventListener('resize', keepInView);
    window.addEventListener('message', onMessage);
    // Once the extension is updated or reloaded, this host is dead: it goes
    // as soon as someone could see it (orphan.ts). Watched while shown only.
    unwatch ??= watchForOrphaning(element, hide);
    keepInView();
  }

  let unwatch: (() => void) | null = null;

  /**
   * A panel dragged near an edge stays reachable when the window shrinks or
   * the page zooms: its title bar is kept on screen, as dragging keeps it (#29).
   */
  function keepInView(): void {
    if (element.style.getPropertyValue('left') === '') return;
    const at = element.getBoundingClientRect();
    const left = clamp(at.left, 0, window.innerWidth - element.offsetWidth);
    const top = clamp(at.top, 0, window.innerHeight - brand.offsetHeight);
    if (left !== at.left || top !== at.top) {
      pin(element, { left: `${left}px`, top: `${top}px`, right: 'auto' });
    }
  }

  const observer = new MutationObserver(() => {
    if (!open) return;
    // Our extension is gone: leave the page to the version that replaced it.
    if (isOrphaned()) {
      hide();
      return;
    }
    // An older version's host puts itself back after we removed it, a few
    // times before it gives up.
    clearLeftovers();
    if (element.isConnected) return;
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
    page = null;
    observer.disconnect();
    // Removing the frame unloads the panel document, which ends its request.
    body.replaceChildren();
    element.remove();
    window.removeEventListener('resize', keepInView);
    window.removeEventListener('message', onMessage);
    mounted = null;
    unwatch?.();
    unwatch = null;
    // A quote the panel pointed at is no longer explained by anything.
    clearQuoteHighlight();
  }

  close.addEventListener('click', hide);
  makeDraggable(element, brand, frame, close);

  return {
    open(requested, triggeredOn) {
      if (open && !failed && requested === 'page' && mode === 'page') return;
      if (open) hide();
      mode = requested;
      trigger = triggeredOn;
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
