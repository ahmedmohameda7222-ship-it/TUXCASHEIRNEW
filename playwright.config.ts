import { defineConfig } from '@playwright/test';

const menuLayoutTouchSpec = /menu-layout-editor\.touch\.e2e\.ts/;

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.e2e\.ts/,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI']
    ? [['line'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : 'line',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH']
      ? { launchOptions: { executablePath: process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'] } }
      : {}),
  },
  projects: [
    {
      name: 'desktop-browser-fallback',
      testIgnore: menuLayoutTouchSpec,
      use: { browserName: 'chromium', viewport: { width: 1440, height: 960 } },
    },
    {
      name: 'mobile-tablet-browser-fallback',
      testIgnore: menuLayoutTouchSpec,
      use: { browserName: 'chromium', viewport: { width: 768, height: 1024 } },
    },
    {
      name: 'mobile-browser-fallback',
      testIgnore: menuLayoutTouchSpec,
      use: { browserName: 'chromium', viewport: { width: 375, height: 812 } },
    },
    {
      name: 'touch-mobile-browser-fallback',
      testMatch: menuLayoutTouchSpec,
      use: {
        browserName: 'chromium',
        viewport: { width: 375, height: 812 },
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: 'npm run e2e:serve',
    url: 'http://127.0.0.1:4173',
    timeout: 120_000,
    reuseExistingServer: !process.env['CI'],
  },
});
