import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Colour contrast of the theme tokens against WCAG 2.1 AA
 * (docs/development-plan.md §4.7): 4.5:1 for text, 3:1 for the edges of form
 * controls and the focus ring (1.4.11). Every pair below is one the pages
 * actually draw; the light, dark and system-dark sets are all checked.
 */
const css = readFileSync(
  path.resolve(import.meta.dirname, '../../../src/features/theme/tokens.css'),
  'utf8',
);

function tokens(selector: RegExp): Record<string, string> {
  const block = selector.exec(css)?.[1];
  if (block === undefined) throw new Error(`No block for ${String(selector)}`);
  return Object.fromEntries(
    [...block.matchAll(/--color-([\w-]+):\s*(#[0-9a-f]{6});/gi)].map(
      ([, name = '', value = '']) => [name, value],
    ),
  );
}

const light = tokens(/:root\s*\{([^}]*)\}/);
const dark = tokens(/:root\[data-theme='dark'\]\s*\{([^}]*)\}/);
const systemDark = tokens(/:root\[data-theme='system'\]\s*\{([^}]*)\}/);

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

/** [foreground, background, minimum]: what the pages draw on what. */
const PAIRS: [string, string, number][] = [
  // Body text, labels and hints, on the page and inside cards.
  ['text', 'bg', 4.5],
  ['text', 'surface', 4.5],
  ['muted', 'bg', 4.5],
  ['muted', 'surface', 4.5],
  // Links, quote markers and secondary buttons are accent-coloured text.
  ['accent', 'bg', 4.5],
  ['accent', 'surface', 4.5],
  // Primary buttons.
  ['on-accent', 'accent', 4.5],
  ['danger', 'bg', 4.5],
  ['danger', 'surface', 4.5],
  ['notice-text', 'notice-bg', 4.5],
  // The conclusion card, and a quote marker under the pointer.
  ['text', 'tint', 4.5],
  ['accent', 'tint', 4.5],
  // A quote's preview is the page's colours the other way round.
  ['bg', 'text', 4.5],
  // The edges of inputs and selects, and the focus ring.
  ['control-border', 'bg', 3],
  ['control-border', 'surface', 3],
];

describe('theme contrast', () => {
  it('reads every token set', () => {
    for (const set of [light, dark, systemDark]) {
      for (const [foreground, background] of PAIRS) {
        expect(set[foreground]).toBeDefined();
        expect(set[background]).toBeDefined();
      }
    }
  });

  it.each([
    ['light', light],
    ['dark', dark],
  ] as const)('meets WCAG AA in the %s theme', (_, set) => {
    const failing = PAIRS.filter(
      ([foreground, background, minimum]) =>
        contrast(set[foreground] ?? '', set[background] ?? '') < minimum,
    ).map(
      ([foreground, background]) =>
        `${foreground} on ${background}: ${contrast(set[foreground] ?? '', set[background] ?? '').toFixed(2)}`,
    );
    expect(failing).toEqual([]);
  });

  it('gives the system dark theme the same colours as the dark one', () => {
    expect(systemDark).toEqual(dark);
  });

  it('computes contrast the WCAG way', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21);
    expect(contrast('#ffffff', '#ffffff')).toBe(1);
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });
});
