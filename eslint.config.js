// @ts-check
import js from '@eslint/js';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import { importX } from 'eslint-plugin-import-x';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Layering, lowest first: contract → domain → platform → features → entrypoints
// (docs/development-plan.md §2.2). A layer may only import from layers below it.
const layerZones = [
  {
    target: './src/contract',
    from: ['./src/domain', './src/platform', './src/features', './src/entrypoints'],
    message: 'contract 是最底层：只依赖 zod 和 contract 自身。',
  },
  {
    target: './src/domain',
    from: ['./src/platform', './src/features', './src/entrypoints'],
    message: 'domain 是纯函数层：只依赖 contract，不碰浏览器 API。',
  },
  {
    target: './src/platform',
    from: ['./src/features', './src/entrypoints'],
    message: 'platform 不能依赖界面层或入口。',
  },
  {
    target: './src/features',
    from: ['./src/entrypoints'],
    message: 'features 不能依赖入口。',
  },
];

// One write path: only platform/storage touches the raw storage adapter, so
// every write goes through a record and its queue (§2.2 单一写队列).
const storageZones = [
  {
    target: [
      './src/contract/**',
      './src/domain/**',
      './src/features/**',
      './src/entrypoints/**',
      './src/platform/!(storage)/**',
    ],
    from: './src/platform/storage/wxt-store.ts',
    message:
      '只有 platform/storage 能直接使用存储适配器；其它地方通过 platform/storage 的 record 读写。',
  },
];

export default tseslint.config(
  {
    ignores: [
      '.output/**',
      '.wxt/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  // `eslint-disable` comments are not allowed (DoD): with inline config off
  // they have no effect and are reported, and `--max-warnings 0` fails on them.
  { linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' } },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['src/**/*.tsx'],
    extends: [reactHooks.configs.flat['recommended-latest'], jsxA11y.flatConfigs.recommended],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver-next': [createTypeScriptImportResolver({ project: './tsconfig.json' })],
    },
    rules: {
      'import-x/no-restricted-paths': ['error', { zones: [...layerZones, ...storageZones] }],
    },
  },
  {
    files: ['scripts/**/*.ts', 'tests/**/*.ts', 'e2e/**/*.ts', '*.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // Playwright reads a fixture's dependencies from its first parameter, which
    // must be an object pattern even when the fixture depends on nothing.
    files: ['e2e/**/*.ts'],
    rules: { 'no-empty-pattern': ['error', { allowObjectPatternsAsParameters: true }] },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
