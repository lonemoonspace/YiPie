import {
  checkLocales,
  checkManifest,
  findTestHooks,
  type LocaleMessages,
} from './manifest-policy.ts';

/** A file of the release package or of the build folder, by its path inside it. */
export interface PackageFile {
  path: string;
  text: string;
}

export interface ReleaseInput {
  /** `version` in package.json: what this release is. */
  version: string;
  /** Every file in the zip. */
  zip: PackageFile[];
  /** Every file in `.output/chrome-mv3`, the folder the zip should hold. */
  build: PackageFile[];
}

/** Files that have no business in a release package (docs/development-plan.md §4.7). */
const FORBIDDEN_FILES: [RegExp, string][] = [
  [/\.map$/, 'source map'],
  [/(^|\/)\.env/, '.env 文件'],
  [/(^|\/)(e2e|tests?|__tests__|fixtures?)\//, '测试目录'],
  [/\.(test|spec)\.[cm]?[jt]sx?$/, '测试文件'],
  [/(^|\/)\.DS_Store$/, '系统残留'],
];

/**
 * Checks a release package against step 6 of the release steps in
 * docs/development-plan.md §4.7. Returns one message per problem; an empty
 * list means the package is fit to publish.
 */
export function checkRelease({ version, zip, build }: ReleaseInput): string[] {
  const problems: string[] = [];

  const manifestIn = (files: PackageFile[], where: string): Record<string, unknown> | null => {
    const file = files.find((candidate) => candidate.path === 'manifest.json');
    if (file === undefined) {
      problems.push(`${where} 里没有 manifest.json`);
      return null;
    }
    try {
      return JSON.parse(file.text) as Record<string, unknown>;
    } catch {
      problems.push(`${where} 的 manifest.json 不是有效的 JSON`);
      return null;
    }
  };

  const zipped = manifestIn(zip, 'zip');
  const built = manifestIn(build, '.output/chrome-mv3');
  if (zipped !== null && zipped.version !== version) {
    problems.push(
      `zip 里 manifest 的 version 是 ${String(zipped.version)}，package.json 是 ${version}`,
    );
  }
  if (built !== null && built.version !== version) {
    problems.push(
      `.output/chrome-mv3 里 manifest 的 version 是 ${String(built.version)}，package.json 是 ${version}`,
    );
  }

  if (zipped !== null) {
    problems.push(...checkManifest(zipped).map((problem) => `zip：${problem}`));
    problems.push(...checkLocales(zipped, localesIn(zip)).map((problem) => `zip：${problem}`));
  }

  for (const file of zip) {
    for (const [pattern, what] of FORBIDDEN_FILES) {
      if (pattern.test(file.path)) problems.push(`zip 里有${what}：${file.path}`);
    }
    if (/\.(js|css)$/.test(file.path) && /[#@] sourceMappingURL=/.test(file.text)) {
      problems.push(`zip 里 ${file.path} 引用了 source map`);
    }
  }
  const scripts = zip.filter((file) => file.path.endsWith('.js'));
  for (const path of findTestHooks(scripts))
    problems.push(`zip 里 ${path} 含有 E2E 构建专用的触发入口`);

  // The zip must be exactly the folder that was checked and tested.
  const inZip = new Map(zip.map((file) => [file.path, file.text]));
  const inBuild = new Map(build.map((file) => [file.path, file.text]));
  for (const [path, text] of inBuild) {
    if (!inZip.has(path)) problems.push(`zip 里缺少 ${path}`);
    else if (inZip.get(path) !== text) problems.push(`zip 里的 ${path} 与 .output/chrome-mv3 不同`);
  }
  for (const path of inZip.keys()) {
    if (!inBuild.has(path)) problems.push(`zip 里多出 ${path}（不在 .output/chrome-mv3 里）`);
  }

  return problems;
}

function localesIn(files: PackageFile[]): LocaleMessages {
  const locales: LocaleMessages = {};
  for (const file of files) {
    const match = /^_locales\/([^/]+)\/messages\.json$/.exec(file.path);
    if (match?.[1] === undefined) continue;
    try {
      locales[match[1]] = JSON.parse(file.text) as Record<string, unknown>;
    } catch {
      locales[match[1]] = {};
    }
  }
  return locales;
}
