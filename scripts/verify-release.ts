// Checks the release package before it is published (docs/development-plan.md
// §4.7, step 6): the zip's manifest and the build's both carry the version in
// package.json, the permissions match appendix C, and there are no source
// maps, .env files, test leftovers or E2E hooks. Run after `npm run zip`:
// `npm run verify:release`.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { checkRelease, type PackageFile } from './lib/release-check.ts';
import { readZip } from './lib/zip.ts';

const outputDir = '.output';
const buildDir = path.join(outputDir, 'chrome-mv3');
const { version } = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };

const zips = (await readdir(outputDir)).filter((file) => file.endsWith('-chrome.zip'));
const expected = zips.find((file) => file.endsWith(`-${version}-chrome.zip`));
const problems: string[] = [];
if (zips.length !== 1 || expected === undefined) {
  problems.push(
    `.output 里应该只有一个 *-${version}-chrome.zip，实际是：${zips.join(', ') || '没有'}（先清掉旧包再 npm run zip）`,
  );
}

if (expected !== undefined) {
  const zip: PackageFile[] = readZip(await readFile(path.join(outputDir, expected))).map(
    (entry) => ({ path: entry.name, text: entry.data.toString('utf8') }),
  );
  const build: PackageFile[] = await Promise.all(
    (await readdir(buildDir, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const full = path.join(entry.parentPath, entry.name);
        return {
          path: path.relative(buildDir, full).split(path.sep).join('/'),
          text: await readFile(full, 'utf8'),
        };
      }),
  );
  problems.push(...checkRelease({ version, zip, build }));
  if (problems.length === 0) {
    console.log(
      `${path.join(outputDir, expected)} 可以发布：version ${version}，${zip.length} 个文件，权限符合附录 C`,
    );
  }
}

if (problems.length > 0) {
  console.error('发布包没有通过检查：');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exitCode = 1;
}
