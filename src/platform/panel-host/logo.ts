const SVG = 'http://www.w3.org/2000/svg';

/**
 * The extension's icon (public/icon, store/images/icon.svg) drawn as SVG
 * nodes: an image from the extension would have to be a web-accessible
 * resource, and the shell asks for no more than it has (appendix C). It is
 * decoration; the shell names the panel elsewhere.
 */
export function createLogo(): SVGSVGElement {
  const svg = element('svg', { class: 'logo', viewBox: '16 16 96 96', 'aria-hidden': 'true' });
  const defs = element('defs', {});
  const gradient = element('linearGradient', { id: 'logo', x1: '0', y1: '0', x2: '1', y2: '1' });
  gradient.append(
    element('stop', { offset: '0', 'stop-color': '#3d7cf0' }),
    element('stop', { offset: '1', 'stop-color': '#1f56b8' }),
  );
  defs.append(gradient);
  svg.append(
    defs,
    element('rect', { x: '16', y: '16', width: '96', height: '96', rx: '24', fill: 'url(#logo)' }),
    element('path', {
      fill: '#ffffff',
      d: 'M83 29 C91 28 96 35 92 42 C82 66 63 85 32 98 C52 79 66 57 73 37 C75 32 78 29 83 29 Z',
    }),
  );
  return svg;
}

function element<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}
