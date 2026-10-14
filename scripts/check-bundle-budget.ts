// Fails when an entry point outgrows its budget in §9 of the plan, and
// writes .output/bundle-report.json as the baseline for the next comparison.
// Run after `npm run build`: `npm run check:bundle`.
import { readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { categorize, evaluateBundle, formatKb, type BuiltFile } from './lib/bundle-budget.ts';

const buildDir = '.output/chrome-mv3';

async function listFiles(dir: string): Promise<BuiltFile[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());
  return Promise.all(
    files.map(async (entry) => {
      const absolute = path.join(entry.parentPath, entry.name);
      const relative = path.relative(buildDir, absolute).split(path.sep).join('/');
      return { path: relative, size: (await stat(absolute)).size };
    }),
  );
}

const files = (await listFiles(buildDir)).sort((a, b) => a.path.localeCompare(b.path));
const report = evaluateBundle(files);

for (const file of files) {
  console.log(
    `${formatKb(file.size).padStart(12)}  ${categorize(file.path).padEnd(13)} ${file.path}`,
  );
}
console.log(`${formatKb(report.totals.total).padStart(12)}  total`);

await writeFile('.output/bundle-report.json', `${JSON.stringify({ files, ...report }, null, 2)}\n`);

if (report.violations.length > 0) {
  console.error('超出体积预算：');
  for (const violation of report.violations) console.error(`  - ${violation}`);
  process.exitCode = 1;
} else {
  console.log('所有入口都在预算之内。');
}
