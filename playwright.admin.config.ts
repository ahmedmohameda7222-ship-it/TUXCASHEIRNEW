import { defineConfig } from '@playwright/test';

const adminE2ePort = process.env['ADMIN_E2E_PORT'] ?? '4175';
const adminE2eUrl = `http://127.0.0.1:${adminE2ePort}`;

export default defineConfig({
  testDir: './e2e',
  testMatch:
    /admin-(?:auth|shell|catalog|catalog-publish|catalog-recurring-availability|settings|approvals-audit|approvals-pagination|inventory|purchasing|orders|customers-promotions|delivery|workforce|finance|reports)\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI']
    ? [['line'], ['html', { outputFolder: 'playwright-report-admin', open: 'never' }]]
    : 'line',
  use: {
    baseURL: adminE2eUrl,
    browserName: 'chromium',
    viewport: { width: 1440, height: 960 },
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH']
      ? {
          launchOptions: {
            executablePath: process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'],
          },
        }
      : {}),
  },
  ...(process.env['ADMIN_E2E_EXTERNAL_SERVER']
    ? {}
    : {
        webServer: {
          command: `npm run build:admin && npm run preview -w @tux/admin -- --host 127.0.0.1 --port ${adminE2ePort}`,
          url: adminE2eUrl,
          timeout: 120_000,
          reuseExistingServer: !process.env['CI'],
        },
      }),
});
