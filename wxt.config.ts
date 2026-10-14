import { defineConfig } from 'wxt';

// Appendix C of docs/development-plan.md is the authority for every manifest
// entry; `npm run check:manifest` fails when the built manifest drifts from it.
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  // No auto-imports: every dependency is an explicit import, so the layering
  // rules in eslint.config.js can see (and police) all of them.
  imports: false,
  manifest: {
    name: '一瞥 YiPie',
    description: '用你自己配置的 OpenAI 兼容模型服务，总结当前网页',
    permissions: ['storage'],
    // Granted per origin at runtime, when the user saves a model configuration.
    optional_host_permissions: ['https://*/*', 'http://*/*'],
  },
});
