// Fails when the production build drifts from appendix C of the plan, or
// still carries the E2E build's test hook. Run after `npm run build`:
// `npm run check:manifest`.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { checkManifest, findTestHooks } from './lib/manifest-policy.ts';

const buildDir = '.output/chrome-mv3';
const manifestPath = path.join(buildDir, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
const problems = checkManifest(manifest);

const scripts = (await readdir(buildDir, { recursive: true }))
  .filter((file) => file.endsWith('.js'))
  .map((file) => file.split(path.sep).join('/'));
const files = await Promise.all(
  scripts.map(async (file) => ({
    path: file,
    text: await readFile(path.join(buildDir, file), 'utf8'),
  })),
);
for (const file of findTestHooks(files)) problems.push(`${file} 含有 E2E 构建专用的触发入口`);

if (problems.length > 0) {
  console.error(`${buildDir} 不符合附录 C：`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exitCode = 1;
} else {
  console.log(
    `${manifestPath} 符合附录 C：permissions = ${JSON.stringify(manifest.permissions)}；` +
      `${scripts.length} 个脚本里没有测试入口`,
  );
}
