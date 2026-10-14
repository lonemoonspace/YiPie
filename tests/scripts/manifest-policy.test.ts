import { describe, expect, it } from 'vitest';
import { checkManifest, findTestHooks } from '../../scripts/lib/manifest-policy';

const valid = {
  manifest_version: 3,
  name: 'YiPie',
  version: '0.0.0',
  permissions: ['storage', 'activeTab', 'scripting'],
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
    expect(checkManifest({ ...valid, permissions: ['storage', 'activeTab'] })[0]).toContain(
      'scripting',
    );
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
