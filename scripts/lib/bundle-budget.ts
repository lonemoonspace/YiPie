/**
 * Size budgets per entry point, from §9 of docs/development-plan.md.
 * Sizes are minified and uncompressed (what Chrome parses); 1 kB = 1000 bytes,
 * matching WXT's build output.
 */
export const BUDGETS = {
  background: 150_000,
  contentScript: 100_000,
  sharedChunks: 450_000,
  panelEntry: 150_000,
  total: 900_000,
};

export type BudgetName = keyof typeof BUDGETS;

export type Category =
  'background' | 'contentScript' | 'panelEntry' | 'optionsEntry' | 'sharedChunks' | 'other';

export interface BuiltFile {
  /** Relative to the build directory, with forward slashes. */
  path: string;
  size: number;
}

export interface BundleReport {
  totals: Record<Category | 'total', number>;
  violations: string[];
}

export function categorize(path: string): Category {
  if (path === 'background.js') return 'background';
  // Our one content script, injected on demand (src/entrypoints/injected.ts).
  if (path === 'injected.js' || /^content-scripts\/[^/]+\.js$/.test(path)) return 'contentScript';
  if (/^chunks\/panel-[^/]+\.js$/.test(path)) return 'panelEntry';
  if (/^chunks\/options-[^/]+\.js$/.test(path)) return 'optionsEntry';
  // Any other chunk is code shared between extension pages (React and friends).
  if (/^chunks\/[^/]+\.js$/.test(path)) return 'sharedChunks';
  return 'other';
}

export function evaluateBundle(
  files: BuiltFile[],
  budgets: Record<BudgetName, number> = BUDGETS,
): BundleReport {
  const totals: BundleReport['totals'] = {
    background: 0,
    contentScript: 0,
    panelEntry: 0,
    optionsEntry: 0,
    sharedChunks: 0,
    other: 0,
    total: 0,
  };

  for (const file of files) {
    totals[categorize(file.path)] += file.size;
    totals.total += file.size;
  }

  const violations = (Object.keys(budgets) as BudgetName[])
    .filter((name) => totals[name] > budgets[name])
    .map((name) => `${name}：${formatKb(totals[name])}，超出预算 ${formatKb(budgets[name])}`);

  return { totals, violations };
}

export function formatKb(bytes: number): string {
  return `${(bytes / 1000).toFixed(2)} kB`;
}
