const SVG = 'http://www.w3.org/2000/svg';

/**
 * The extension's icon (public/icon, store/images/icon.svg) drawn as SVG
 * nodes: an image from the extension would have to be a web-accessible
 * resource, and the shell asks for no more than it has (appendix C). It is
 * decoration; the shell names the panel elsewhere.
 */
export function createLogo(): SVGSVGElement {
  const svg = element('svg', { class: 'logo', viewBox: '16 16 96 96', 'aria-hidden': 'true' });
  svg.append(
    element('rect', { x: '16', y: '16', width: '96', height: '96', rx: '24', fill: '#ffffff' }),
    element('rect', {
      x: '16.5',
      y: '16.5',
      width: '95',
      height: '95',
      rx: '23.5',
      fill: 'none',
      stroke: '#e3e6ec',
    }),
    line('M38 42 H90', '#c5cad4'),
    // The highlighter swipe across the line that matters.
    element('path', {
      fill: '#ffd23f',
      d: 'M36 54 C63 52.5 63 55 96 53 L91 73 C63 75 63 73 29 75 Z',
    }),
    line('M40 64 H86', '#1d2433'),
    line('M38 86 H74', '#c5cad4'),
  );
  return svg;
}

function line(d: string, stroke: string): SVGPathElement {
  return element('path', { d, stroke, 'stroke-width': '7', 'stroke-linecap': 'round' });
}

function element<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}
