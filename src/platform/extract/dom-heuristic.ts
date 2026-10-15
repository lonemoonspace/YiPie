import { textOf } from './text';

/**
 * What is never the content of a page: scripts and styles, navigation, site
 * headers and footers, sidebars, forms, and what the page hides from
 * assistive technology.
 */
const BOILERPLATE = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'canvas',
  'nav',
  'header',
  'footer',
  'aside',
  'form',
  'dialog',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[role="complementary"]',
  '[role="search"]',
  '[aria-hidden="true"]',
  '[hidden]',
].join(',');

/** Where a page says its content is. */
const CONTENT_LANDMARKS = 'main, [role="main"], article';

/**
 * The page text when Readability finds no article (docs/development-plan.md
 * §4.6): boilerplate removed, then the landmark with the most text if the
 * page marks its content, else what is left of the body. Works on `doc` as
 * given, which it changes: pass a copy.
 */
export function heuristicText(doc: Document): string {
  for (const element of doc.querySelectorAll(BOILERPLATE)) element.remove();
  const body = doc.body;
  if (body === null) return '';

  let best: Element = body;
  let bestLength = 0;
  for (const landmark of doc.querySelectorAll(CONTENT_LANDMARKS)) {
    const length = (landmark.textContent ?? '').trim().length;
    if (length > bestLength) {
      best = landmark;
      bestLength = length;
    }
  }
  return textOf(best);
}
