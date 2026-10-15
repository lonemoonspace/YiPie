import { defineConfig } from 'wxt';
import { SUMMARIZE_COMMAND } from './src/contract/commands';

// Appendix C of docs/development-plan.md is the authority for every manifest
// entry; `npm run check:manifest` fails when the built manifest drifts from it.
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  // No auto-imports: every dependency is an explicit import, so the layering
  // rules in eslint.config.js can see (and police) all of them.
  imports: false,
  manifest: ({ mode }) => ({
    // Words the browser shows itself, in its own language (public/_locales):
    // it cannot follow the interface language in the settings.
    default_locale: 'zh_CN',
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    permissions: ['storage', 'activeTab', 'scripting', 'contextMenus'],
    // Granted per origin at runtime, when the user saves a model configuration.
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    // No popup: a click goes straight to action.onClicked and opens the panel.
    action: { default_title: '__MSG_actionTitle__' },
    commands: {
      [SUMMARIZE_COMMAND]: {
        suggested_key: { default: 'Alt+Shift+Y' },
        description: '__MSG_summarizeCommand__',
      },
    },
    // The panel is the only page a website can load, and only through the
    // per-session dynamic URL that our content script gets from the runtime.
    web_accessible_resources: [
      { resources: ['panel.html'], matches: ['http://*/*', 'https://*/*'], use_dynamic_url: true },
    ],
    // Defence in depth for the Markdown pipeline (§8): no remote images, no
    // frames, no form submissions, no <base>, no plugins.
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'none'; img-src 'self' data:; frame-src 'none'; form-action 'none'; base-uri 'none'",
    },
    // E2E build only (`--mode e2e`): Playwright cannot click the toolbar icon,
    // so the tests need host access to the local fixture server instead of
    // activeTab (§6). check:manifest fails if this reaches production.
    ...(mode === 'e2e' ? { host_permissions: ['http://127.0.0.1/*', 'http://localhost/*'] } : {}),
  }),
});
