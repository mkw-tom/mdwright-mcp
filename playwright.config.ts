import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/spec',                 // 生成先だけを実行
  retries: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:8080', // デモ用
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  reporter: [['list'], ['html', { outputFolder: 'playwright-report' }]],
  testIgnore: ['**/tests/nl/**', '**/tests/scenarios/**']
});