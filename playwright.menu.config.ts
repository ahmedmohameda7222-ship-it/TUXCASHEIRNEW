import { defineConfig } from '@playwright/test';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const CATALOG_URL = 'https://catalog.test/functions/v1/catalog-public';
const ORDER_INTAKE_URL = 'https://orders.test/functions/v1/order-intake';

export default defineConfig({
  testDir: './e2e/menu',
  testMatch: /.*\.e2e\.ts/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI']
    ? [['line'], ['html', { outputFolder: 'playwright-report-menu', open: 'never' }]]
    : 'line',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop-menu',
      use: { browserName: 'chromium', viewport: { width: 1440, height: 960 } },
    },
    {
      name: 'mobile-menu-390x844',
      use: { browserName: 'chromium', viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: 'npm run build:menu && npm run preview -w @tux/menu -- --host 127.0.0.1 --port 4174',
    url: 'http://127.0.0.1:4174',
    timeout: 120_000,
    reuseExistingServer: !process.env['CI'],
    env: {
      ...process.env,
      VITE_CATALOG_PUBLIC_URL: CATALOG_URL,
      VITE_ORDER_INTAKE_URL: ORDER_INTAKE_URL,
      VITE_TUX_SHOP_ID: SHOP_ID,
    },
  },
});
