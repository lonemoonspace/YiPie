import { browser } from 'wxt/browser';

/*
 * After the extension is updated or reloaded, the content script of the old
 * version lives on in the pages it was injected into, cut off: its runtime is
 * gone, and nothing it asks the background is answered. A content script
 * injected afterwards runs in a new isolated world and cannot reach the old
 * one's objects, only its element in the page (docs/development-plan.md
 * §4.5).
 */

/** What every host's tag name starts with; the rest is random (host.ts). */
export const HOST_TAG_PREFIX = 'yipie-panel-';

/** Whether the extension this script came from is gone: updated, reloaded or removed. */
export function isOrphaned(): boolean {
  try {
    return browser.runtime.id === undefined;
  } catch {
    return true;
  }
}

/**
 * Calls `onOrphaned`, once, when this script finds its extension gone. It
 * looks when the page comes back into view or gets the focus, and when the
 * user touches `element`: the moments someone could see a dead panel. Looking
 * reads one property; it wakes nothing.
 */
export function watchForOrphaning(element: HTMLElement, onOrphaned: () => void): void {
  const watched: [EventTarget, string][] = [
    [document, 'visibilitychange'],
    [window, 'focus'],
    [element, 'pointerdown'],
  ];
  const check = () => {
    if (!isOrphaned()) return;
    for (const [target, type] of watched) target.removeEventListener(type, check, true);
    onOrphaned();
  };
  for (const [target, type] of watched) target.addEventListener(type, check, true);
}

/**
 * Removes the hosts an older version left in the page, which a new host
 * would otherwise sit on, and says how many it removed. Only our live host
 * is ever ours to keep: anything else with that name is dead or the page's
 * own, and goes either way.
 */
export function removeLeftoverHosts(keep: Element): number {
  let removed = 0;
  for (const element of [...document.documentElement.children]) {
    if (element !== keep && element.tagName.toLowerCase().startsWith(HOST_TAG_PREFIX)) {
      element.remove();
      removed += 1;
    }
  }
  return removed;
}
