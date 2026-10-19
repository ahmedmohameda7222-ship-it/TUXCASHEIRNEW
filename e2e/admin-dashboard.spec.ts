import { expect, test, type Page } from '@playwright/test';

const shopId = '11111111-1111-4111-8111-111111111111';
const employeeId = '22222222-2222-4222-8222-222222222222';

async function mockHome(page: Page, role: 'OWNER' | 'MANAGER') {
  await page.route('**/api/admin/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        principal: {
          businessId: '33333333-3333-4333-8333-333333333333',
          employeeId,
          role,
          shopIds: [shopId],
          shopSummaries: [{ id: shopId, name: 'TUX Maadi', active: true, temporaryClosed: false }],
          permissions: [
            'reports.view',
            'staff.view',
            'delivery.view',
            ...(role === 'OWNER'
              ? ['finance.view', 'catalog.view', 'inventory.view', 'approvals.review']
              : []),
          ],
        },
        csrfToken: 'f'.repeat(64),
      }),
    });
  });
  await page.route('**/api/admin/reports**', async (route) => {
    const url = new URL(route.request().url());
    const view = url.searchParams.get('view');
    const content =
      view === 'dashboard'
        ? {
            ok: true,
            netSalesMinor: 155000,
            orderCount: 12,
            averageOrderMinor: 12917,
            estimatedOperatingProfitMinor: 51000,
            lowStockCount: 2,
            outOfStockCount: 1,
            failedOnlineOrderCount: 1,
            pendingApprovalCount: 3,
            staffOnShiftCount: 4,
            deliveryOpenCount: 2,
            salesTrend: [
              { date: '2026-10-02', netSalesMinor: 20000 },
              { date: '2026-10-03', netSalesMinor: 25000 },
              { date: '2026-10-04', netSalesMinor: 15000 },
            ],
            topProducts: [{ name: 'Espresso', quantity: 7, recordedSalesMinor: 24000 }],
            sourceMix: [
              { source: 'POS', orderCount: 10 },
              { source: 'ONLINE', orderCount: 2 },
            ],
            shopComparison: [{ shopName: 'Main shop', orderCount: 12, netSalesMinor: 155000 }],
          }
        : view === 'configuration'
          ? { savedViews: [], targets: [] }
          : view === 'filter-options'
            ? { options: {} }
            : {
                ok: true,
                summary: {
                  eventCount: 0,
                  orderCount: 12,
                  totalAmountMinor: 155000,
                  totalQuantity: 0,
                  incompleteCostEvents: 0,
                  coverageNote: null,
                },
                rows: [],
                nextOffset: null,
              };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(content),
    });
  });
  await page.route('**/api/admin/finance**', async (route) => {
    const url = new URL(route.request().url());
    const content =
      url.searchParams.get('view') === 'owner-summary'
        ? { summaries: [] }
        : url.searchParams.get('view') === 'days'
          ? { days: [] }
          : { ok: true };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(content),
    });
  });
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 960 },
]) {
  test(`owner Home sourced KPIs and responsive layout ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await mockHome(page, 'OWNER');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
    await expect(page.getByText('Business overview')).toBeVisible();
    await expect(page.getByText('Net sales today')).toBeVisible();
    await expect(page.getByText('Estimated operating profit')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Seven-day sales trend' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Top recorded products' })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
}

test('manager Home prioritizes assigned shop operations and not owner profit', async ({ page }) => {
  await mockHome(page, 'MANAGER');
  await page.goto('/');
  await expect(page.getByText('Shop overview')).toBeVisible();
  await expect(page.getByText('Staff clocked in')).toBeVisible();
  await expect(page.getByText('Active deliveries')).toBeVisible();
  await expect(page.getByText('Estimated operating profit')).toHaveCount(0);
});

for (const viewport of [
  { width: 320, height: 720 },
  { width: 375, height: 844 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
]) {
  test(`P01 decision-first dashboard at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockHome(page, 'OWNER');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
    await expect(page.getByText('TUX Maadi').first()).toBeVisible();
    await expect(page.getByRole('region', { name: 'Needs attention' })).toBeVisible();
    await expect(page.getByText('Failed online orders').first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Open reports/i }).first()).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({
      path: `test-results/p01-dashboard-owner-${viewport.width}-light.png`,
      fullPage: true,
    });
  });
}

test('P01 distinguishes real zero from loading and reports failures', async ({ page }) => {
  await mockHome(page, 'OWNER');
  await page.route('**/api/admin/reports?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('view') === 'dashboard') {
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' });
    } else {
      await route.continue();
    }
  });
  await page.goto('/');
  await expect(page.getByRole('alert').filter({ hasText: /dashboard data/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry dashboard' })).toBeVisible();
  await expect(page.getByText('Net sales today')).toHaveCount(0);
});

test('P01 dark mobile dashboard retains readable status and routes', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 390, height: 844 });
  await mockHome(page, 'OWNER');
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Needs attention' })).toBeVisible();
  await page.screenshot({ path: 'test-results/p01-dashboard-owner-390-dark.png', fullPage: true });
});
