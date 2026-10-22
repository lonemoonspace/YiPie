import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import AxeBuilder from '@axe-core/playwright';
import type { Frame, Page } from '@playwright/test';
import { expect, storeSettings, test, useModel } from './fixtures';

/**
 * Accessibility (docs/development-plan.md §4.7): an automated WCAG 2.1 AA
 * check of what the pages render (axe-core: contrast as drawn, names, roles,
 * labels), and a keyboard walkthrough. jsx-a11y covers the source; this
 * covers the result.
 */
const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const optionsUrl = (extensionId: string) => `chrome-extension://${extensionId}/options.html`;

/** What axe reports, short enough to read in a failed expectation. */
interface Violation {
  id: string;
  targets: string[];
  summary: string;
}

async function checkPage(page: Page): Promise<Violation[]> {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
  return violations.map((violation) => ({
    id: violation.id,
    targets: violation.nodes.map((node) => node.target.join(' ')),
    summary: violation.nodes[0]?.failureSummary ?? '',
  }));
}

const axeSource = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
);

/**
 * The panel's frame sits in a closed shadow root, where AxeBuilder does not
 * reach: axe runs in the frame itself.
 */
async function checkFrame(frame: Frame): Promise<Violation[]> {
  await frame.evaluate(`${axeSource}\n;true`);
  return frame.evaluate(async (tags) => {
    const { axe } = globalThis as unknown as {
      axe: {
        run(
          context: Document,
          options: object,
        ): Promise<{
          violations: {
            id: string;
            nodes: { target: string[]; failureSummary?: string }[];
          }[];
        }>;
      };
    };
    const { violations } = await axe.run(document, { runOnly: { type: 'tag', values: tags } });
    return violations.map((violation) => ({
      id: violation.id,
      targets: violation.nodes.map((node) => node.target.join(' ')),
      summary: violation.nodes[0]?.failureSummary ?? '',
    }));
  }, WCAG_AA);
}

for (const theme of ['light', 'dark'] as const) {
  for (const interfaceLanguage of ['zh-Hans', 'en'] as const) {
    test(`the settings page meets WCAG AA (${theme}, ${interfaceLanguage})`, async ({
      context,
      server,
      serviceWorker,
      extensionId,
    }) => {
      await useModel(serviceWorker, server, 'scenario:normal');
      await storeSettings(serviceWorker, { theme, interfaceLanguage });
      const page = await context.newPage();
      await page.goto(optionsUrl(extensionId));
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('.item')).not.toHaveCount(0);
      // The forms too: edit the model, add a prompt.
      await page.locator('.item button.secondary').first().click();
      await page
        .getByRole('button', { name: interfaceLanguage === 'en' ? 'Add a prompt' : '添加 Prompt' })
        .click();
      await expect(page.locator('form')).toHaveCount(2);

      expect(await checkPage(page)).toEqual([]);
    });
  }

  test(`the panel meets WCAG AA (${theme})`, async ({
    context,
    server,
    serviceWorker,
    openPanel,
    panelFrame,
  }) => {
    // Quote markers, usage, a follow-up: most of what an answer can show.
    await useModel(serviceWorker, server, 'scenario:cite');
    await storeSettings(serviceWorker, { theme });
    const page = await context.newPage();
    await page.goto(`${server.origin}/article.html`);
    await openPanel(page);
    const frame = await panelFrame(page);
    await expect(frame.locator('main')).toHaveAttribute('data-phase', 'done');
    await expect(frame.locator('html')).toHaveAttribute('data-theme', theme);

    expect(await checkFrame(frame)).toEqual([]);
  });
}

/** The focused element: what it is, and whether a focus indicator is drawn. */
interface Focused {
  name: string;
  visible: boolean;
}

function focusedIn(target: Page | Frame): Promise<Focused | null> {
  return target.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement) || element === document.body) return null;
    const style = getComputedStyle(element);
    const name =
      element.getAttribute('aria-label') ||
      element.id ||
      element.textContent?.trim().slice(0, 30) ||
      element.tagName;
    return {
      name: `${element.tagName.toLowerCase()} ${name}`,
      visible:
        element.matches(':focus-visible') &&
        ((style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) ||
          style.boxShadow !== 'none'),
    };
  });
}

/** Every control a keyboard user should reach, as `focusedIn` names it. */
function controlsIn(target: Page | Frame): Promise<string[]> {
  return target.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary',
      ),
    ]
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => {
        const name =
          element.getAttribute('aria-label') ||
          element.id ||
          element.textContent?.trim().slice(0, 30) ||
          element.tagName;
        return `${element.tagName.toLowerCase()} ${name}`;
      }),
  );
}

/** Presses Tab until focus comes back round; returns what it stopped on, in order. */
async function tabThrough(page: Page, target: Page | Frame, limit = 200): Promise<Focused[]> {
  const reached: Focused[] = [];
  for (let step = 0; step < limit; step += 1) {
    await page.keyboard.press('Tab');
    const focused = await focusedIn(target);
    if (focused === null) {
      if (reached.length > 0) break;
      continue;
    }
    if (reached.length > 0 && focused.name === reached[0]?.name) break;
    reached.push(focused);
  }
  return reached;
}

test('the settings page can be used by keyboard alone, with focus always visible', async ({
  context,
  server,
  serviceWorker,
  extensionId,
}) => {
  await useModel(serviceWorker, server, 'scenario:normal');
  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));
  // The model and the built-in prompts.
  await expect(page.locator('.item')).toHaveCount(4);

  const reached = await tabThrough(page, page);

  expect(reached.filter((focused) => !focused.visible)).toEqual([]);
  expect(reached.map((focused) => focused.name).sort()).toEqual((await controlsIn(page)).sort());

  // And it works: open the model form by keyboard, change the name, save.
  await page.getByRole('button', { name: '编辑「scenario:normal」' }).focus();
  await page.keyboard.press('Enter');
  await page.getByLabel('名称', { exact: true }).focus();
  await page.keyboard.type('键盘');
  await page.getByRole('button', { name: '保存', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.item').first()).toContainText('键盘');
});

test('the panel can be used by keyboard alone, with focus always visible', async ({
  context,
  server,
  serviceWorker,
  openPanel,
  panelFrame,
}) => {
  await useModel(serviceWorker, server, 'scenario:cite');
  const page = await context.newPage();
  await page.goto(`${server.origin}/article.html`);
  await openPanel(page);
  const frame = await panelFrame(page);
  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'done');

  // Start at the panel's first control and Tab on until focus leaves the
  // panel; Shift+Tab from the next one comes back to it with a visible ring.
  await frame.locator('select.model').focus();
  const first = await focusedIn(frame);
  const reached = await tabThrough(page, frame);
  await frame.getByRole('combobox', { name: 'Prompt' }).focus();
  await page.keyboard.press('Shift+Tab');

  expect(await focusedIn(frame)).toEqual({ name: first?.name, visible: true });
  expect(reached.filter((focused) => !focused.visible)).toEqual([]);
  expect([first?.name, ...reached.map((focused) => focused.name)].sort()).toEqual(
    (await controlsIn(frame)).sort(),
  );

  // A quote marker finds its passage on Enter.
  await frame.getByRole('button', { name: '在网页中定位引用 2' }).focus();
  await page.keyboard.press('Enter');
  await expect(frame.locator('[data-located]')).toContainText('在网页里没找到这段原文');
  // Said aloud: the note arrives in a region that was there before it.
  await expect(frame.locator('[aria-live="polite"] > [data-located]')).toHaveCount(1);

  // A follow-up is typed and sent from the keyboard.
  const before = server.requests.length;
  await frame.getByRole('textbox', { name: '追问' }).focus();
  await page.keyboard.type('还有呢？');
  await page.keyboard.press('Enter');
  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'done');
  expect(server.requests.length).toBe(before + 1);

  // And "Summarize again" starts over on Enter.
  await frame.getByRole('button', { name: '重新总结' }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => server.requests.length).toBe(before + 2);
});
