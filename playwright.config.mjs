import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/playwright',
  timeout: 30000,
  outputDir: '.debug/playwright/results',
  expect: {
    timeout: 5000
  },
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    headless: true,
    locale: 'zh-CN',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    viewport: {
      width: 1600,
      height: 1100
    }
  }
});
