import { describe, expect, it } from 'vitest';
import { checkRelease, type PackageFile } from '../../scripts/lib/release-check';

const manifest = (version: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    manifest_version: 3,
    name: '__MSG_extName__',
    version,
    default_locale: 'zh_CN',
    minimum_chrome_version: '110',
    permissions: ['storage', 'activeTab', 'scripting', 'contextMenus'],
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    action: { default_title: '__MSG_extName__' },
    commands: { 'summarize-page': { suggested_key: { default: 'Alt+Shift+Y' } } },
    web_accessible_resources: [
      { resources: ['panel.html'], matches: ['http://*/*', 'https://*/*'], use_dynamic_url: true },
    ],
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'none'; img-src 'self' data:; frame-src 'none'; form-action 'none'; base-uri 'none'",
    },
    icons: { '16': 'icon/16.png', '32': 'icon/32.png', '48': 'icon/48.png', '128': 'icon/128.png' },
    ...extra,
  });

const build = (version = '1.0.0'): PackageFile[] => [
  { path: 'manifest.json', text: manifest(version) },
  { path: '_locales/zh_CN/messages.json', text: '{"extName":{"message":"一瞥"}}' },
  { path: '_locales/en/messages.json', text: '{"extName":{"message":"YiPie"}}' },
  { path: 'background.js', text: 'console.log(1);' },
];

describe('checkRelease', () => {
  it('passes a package that is the build, at the version in package.json', () => {
    expect(checkRelease({ version: '1.0.0', zip: build(), build: build() })).toEqual([]);
  });

  it('catches a zip or a build at another version', () => {
    const problems = checkRelease({ version: '1.1.0', zip: build('1.0.0'), build: build('1.1.0') });
    expect(problems.join('\n')).toContain('zip 里 manifest 的 version 是 1.0.0');
    const stale = checkRelease({ version: '1.1.0', zip: build('1.1.0'), build: build('1.0.0') });
    expect(stale.join('\n')).toContain('.output/chrome-mv3 里 manifest 的 version 是 1.0.0');
  });

  it('catches source maps, .env files, test leftovers and E2E hooks', () => {
    const extra: PackageFile[] = [
      { path: 'background.js.map', text: '{}' },
      { path: '.env.local', text: 'KEY=x' },
      { path: 'e2e/fixtures.js', text: '' },
      { path: 'chunks/panel.test.js', text: '' },
      { path: 'chunks/hook.js', text: 'globalThis.__yipieE2E = {}' },
      { path: 'chunks/mapped.js', text: 'x;\n//# sourceMappingURL=mapped.js.map' },
    ];
    const zip = [...build(), ...extra];
    const problems = checkRelease({ version: '1.0.0', zip, build: zip }).join('\n');
    expect(problems).toContain('source map：background.js.map');
    expect(problems).toContain('.env 文件：.env.local');
    expect(problems).toContain('测试目录：e2e/fixtures.js');
    expect(problems).toContain('测试文件：chunks/panel.test.js');
    expect(problems).toContain('chunks/hook.js 含有 E2E');
    expect(problems).toContain('chunks/mapped.js 引用了 source map');
  });

  it('catches permissions beyond appendix C, test host access included', () => {
    const zip = build().map((file) =>
      file.path === 'manifest.json'
        ? { ...file, text: manifest('1.0.0', { host_permissions: ['http://127.0.0.1/*'] }) }
        : file,
    );
    expect(checkRelease({ version: '1.0.0', zip, build: zip }).join('\n')).toContain(
      'host_permissions',
    );
  });

  it('catches a zip that is not the build it was checked against', () => {
    const zip = [...build(), { path: 'old.js', text: '' }].filter(
      (file) => file.path !== 'background.js',
    );
    zip.push({ path: 'background.js', text: 'console.log(2);' });
    const problems = checkRelease({ version: '1.0.0', zip, build: build() }).join('\n');
    expect(problems).toContain('zip 里多出 old.js');
    expect(problems).toContain('zip 里的 background.js 与 .output/chrome-mv3 不同');
    const missing = checkRelease({ version: '1.0.0', zip: build().slice(0, 3), build: build() });
    expect(missing.join('\n')).toContain('zip 里缺少 background.js');
  });

  it('catches a manifest name missing from a locale', () => {
    const zip = build().map((file) =>
      file.path === '_locales/en/messages.json' ? { ...file, text: '{}' } : file,
    );
    expect(checkRelease({ version: '1.0.0', zip, build: zip }).join('\n')).toContain(
      '_locales/en 缺少',
    );
  });
});
