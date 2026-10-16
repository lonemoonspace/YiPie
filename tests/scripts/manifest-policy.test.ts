import { describe, expect, it } from 'vitest';
import {
  checkIcons,
  checkLocales,
  checkManifest,
  findTestHooks,
  pngSize,
} from '../../scripts/lib/manifest-policy';

const valid = {
  manifest_version: 3,
  name: '__MSG_extName__',
  version: '0.0.0',
  default_locale: 'zh_CN',
  permissions: ['storage', 'activeTab', 'scripting', 'contextMenus'],
  optional_host_permissions: ['https://*/*', 'http://*/*'],
  action: { default_title: '一瞥：总结此页' },
  commands: { 'summarize-page': { suggested_key: { default: 'Alt+Shift+Y' } } },
  web_accessible_resources: [
    { resources: ['panel.html'], matches: ['http://*/*', 'https://*/*'], use_dynamic_url: true },
  ],
  content_security_policy: {
    extension_pages:
      "script-src 'self'; object-src 'none'; img-src 'self' data:; frame-src 'none'; form-action 'none'; base-uri 'none'",
  },
  background: { service_worker: 'background.js' },
  icons: { '16': 'icon/16.png', '32': 'icon/32.png', '48': 'icon/48.png', '128': 'icon/128.png' },
};

describe('checkManifest', () => {
  it('accepts a manifest that matches the policy', () => {
    expect(checkManifest(valid)).toEqual([]);
  });

  it('catches an extra permission', () => {
    const problems = checkManifest({ ...valid, permissions: [...valid.permissions, 'tabs'] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('tabs');
  });

  it('catches a missing permission', () => {
    expect(
      checkManifest({ ...valid, permissions: ['storage', 'activeTab', 'contextMenus'] })[0],
    ).toContain('scripting');
  });

  it('catches optional host permissions that differ from the list', () => {
    const wider = checkManifest({ ...valid, optional_host_permissions: ['<all_urls>'] });
    expect(wider).toHaveLength(2);
    expect(wider.join('\n')).toContain('<all_urls>');
    expect(checkManifest({ ...valid, optional_host_permissions: undefined })[0]).toContain(
      'optional_host_permissions',
    );
  });

  it.each([
    [
      'a second web-accessible resource',
      {
        web_accessible_resources: [
          ...valid.web_accessible_resources,
          { resources: ['options.html'], matches: ['<all_urls>'] },
        ],
      },
    ],
    [
      'the panel without a dynamic URL',
      {
        web_accessible_resources: [
          { resources: ['panel.html'], matches: ['http://*/*', 'https://*/*'] },
        ],
      },
    ],
    ['a weaker CSP', { content_security_policy: { extension_pages: "script-src 'self'" } }],
  ])('catches %s', (_label, override) => {
    expect(checkManifest({ ...valid, ...override })).toHaveLength(1);
  });

  it('requires the toolbar action without a popup, and the command', () => {
    expect(checkManifest({ ...valid, action: undefined })[0]).toContain('action');
    expect(checkManifest({ ...valid, action: { default_popup: 'popup.html' } })[0]).toContain(
      'default_popup',
    );
    expect(checkManifest({ ...valid, commands: undefined })[0]).toContain('commands');
  });

  it('catches the test build host access and static content scripts', () => {
    expect(checkManifest({ ...valid, host_permissions: ['http://127.0.0.1/*'] })[0]).toContain(
      'host_permissions',
    );
    expect(checkManifest({ ...valid, content_scripts: [] })[0]).toContain('content_scripts');
  });

  it('requires every icon size, the 128 px one the store needs included', () => {
    const small = { '16': 'icon/16.png', '32': 'icon/32.png', '48': 'icon/48.png' };
    expect(checkManifest({ ...valid, icons: small })[0]).toContain('icons');
    expect(checkManifest({ ...valid, icons: undefined })[0]).toContain('icons');
  });

  it('catches a manifest that is not MV3', () => {
    expect(checkManifest({ ...valid, manifest_version: 2 })).toHaveLength(1);
  });
});

describe('findTestHooks', () => {
  it('names the scripts that still carry the E2E trigger', () => {
    expect(
      findTestHooks([
        { path: 'background.js', text: 'globalThis.__yipieE2E={openPanel}' },
        { path: 'injected.js', text: 'nothing to see' },
      ]),
    ).toEqual(['background.js']);
  });
});

describe('checkLocales', () => {
  const zh = { extName: { message: '一瞥 YiPie' } };
  const en = { extName: { message: 'YiPie' } };

  it('accepts locales that define every name the manifest uses', () => {
    expect(checkLocales(valid, { zh_CN: zh, en })).toEqual([]);
  });

  it('catches a missing default locale', () => {
    expect(checkLocales(valid, { en })[0]).toContain('zh_CN');
  });

  it('catches a name a locale lacks, or leaves empty', () => {
    expect(checkLocales(valid, { zh_CN: zh, en: {} }).join()).toContain('_locales/en 缺少');
    const empty = { extName: { message: ' ' } };
    expect(checkLocales(valid, { zh_CN: zh, en: empty }).join()).toContain('extName');
  });

  it('catches locales that define different names', () => {
    const extra = { ...en, other: { message: 'x' } };
    expect(checkLocales(valid, { zh_CN: zh, en: extra }).join()).toContain('不一致');
  });
});

describe('checkIcons', () => {
  const square = (file: string) => {
    const size = Number(/(\d+)\.png$/.exec(file)?.[1]);
    return { width: size, height: size };
  };

  it('accepts icons that are PNGs of their declared size', () => {
    expect(checkIcons(valid, square)).toEqual([]);
  });

  it('names an icon that is missing from the build', () => {
    const problems = checkIcons(valid, (file) => (file === 'icon/128.png' ? null : square(file)));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('icon/128.png');
  });

  it('names an icon whose pixels do not match its declared size', () => {
    const problems = checkIcons(valid, (file) =>
      file === 'icon/16.png' ? { width: 32, height: 32 } : square(file),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('32×32');
  });
});

describe('pngSize', () => {
  it('reads the size from the IHDR chunk', () => {
    const header = new Uint8Array(24);
    header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(header.buffer);
    view.setUint32(16, 128);
    view.setUint32(20, 96);
    expect(pngSize(header)).toEqual({ width: 128, height: 96 });
  });

  it('rejects bytes that are not a PNG', () => {
    expect(pngSize(new TextEncoder().encode('GIF89a and some more bytes here'))).toBeNull();
  });
});
