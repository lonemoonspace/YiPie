import { describe, expect, it } from 'vitest';
import { categorize, evaluateBundle, leakedMessages } from '../../scripts/lib/bundle-budget';

describe('categorize', () => {
  it.each([
    ['background.js', 'background'],
    ['content-scripts/content.js', 'contentScript'],
    ['injected.js', 'contentScript'],
    ['chunks/panel-Ab12.js', 'panelEntry'],
    ['chunks/options-Ab12.js', 'optionsEntry'],
    ['chunks/react-dom-Ab12.js', 'sharedChunks'],
    ['options.html', 'other'],
    ['assets/options-Ab12.css', 'other'],
  ])('%s → %s', (path, category) => {
    expect(categorize(path)).toBe(category);
  });
});

describe('evaluateBundle', () => {
  it('sums sizes per category and in total', () => {
    const report = evaluateBundle([
      { path: 'background.js', size: 100_000 },
      { path: 'chunks/a-1.js', size: 200_000 },
      { path: 'chunks/b-2.js', size: 50_000 },
      { path: 'options.html', size: 500 },
    ]);

    expect(report.totals).toMatchObject({
      background: 100_000,
      sharedChunks: 250_000,
      other: 500,
      total: 350_500,
    });
    expect(report.violations).toEqual([]);
  });

  it('reports every budget that is exceeded', () => {
    const report = evaluateBundle(
      [
        { path: 'background.js', size: 150_001 },
        { path: 'content-scripts/content.js', size: 10 },
      ],
      {
        background: 150_000,
        contentScript: 100_000,
        sharedChunks: 1,
        panelEntry: 1,
        total: 150_000,
      },
    );

    expect(report.violations).toHaveLength(2);
    expect(report.violations.join('\n')).toMatch(/background[\s\S]*total/);
  });
});

describe('leakedMessages', () => {
  const keys = ['settings.title', 'panel.ask', 'model.intro'];

  it('finds keys of the pages table in a built script, however they are quoted', () => {
    const code = 'var a={"settings.title":"\\u8bbe\\u7f6e"};f(\'panel.ask\');g(`model.intro`)';
    expect(leakedMessages(code, keys)).toEqual(keys);
  });

  it('finds none in a script with only its own messages', () => {
    const code = 'var a={"host.unavailable":"x","menu.summarizePage":"y"};t("prompt.builtinName")';
    expect(leakedMessages(code, keys)).toEqual([]);
  });

  it('does not take a key that is only part of a longer one', () => {
    expect(leakedMessages('t("panel.ask.placeholder")', ['panel.ask'])).toEqual([]);
  });
});
