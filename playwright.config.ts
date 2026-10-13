import { defineConfig } from '@playwright/test';

// End-to-end tests run against the production build in .output/chrome-mv3,
// so `npm run build` must come first (CI does this; see quality.yml).
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  // Every test launches its own browser with the extension loaded.
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure' },
});
