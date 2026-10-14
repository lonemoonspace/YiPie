// Fails when the built manifest drifts from appendix C of the plan.
// Run after `npm run build`: `npm run check:manifest`.
import { readFile } from 'node:fs/promises';
import { checkManifest } from './lib/manifest-policy.ts';

const manifestPath = '.output/chrome-mv3/manifest.json';
const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
const problems = checkManifest(manifest);

if (problems.length > 0) {
  console.error(`${manifestPath} 不符合附录 C：`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exitCode = 1;
} else {
  console.log(`${manifestPath} 符合附录 C：permissions = ${JSON.stringify(manifest.permissions)}`);
}
