import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch:
    /admin-(?:auth|shell|catalog|catalog-publish|catalog-recurring-availability|settings)\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI']
    ? [['line'], ['html', { outputFolder: 'playwright-report-admin', open: 'never' }]]
    : 'line',
  use: {
    baseURL: 'http://127.0.0.1:4175',
    browserName: 'chromium',
    viewport: { width: 1440, height: 960 },
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run build:admin && npm run preview -w @tux/admin -- --host 127.0.0.1 --port 4175',
    url: 'http://127.0.0.1:4175',
    timeout: 120_000,
    reuseExistingServer: !process.env['CI'],
  },
});
