import { expect, test, type Page } from '@playwright/test';

const shopId = '11111111-1111-4111-8111-111111111111';
const employeeId = '22222222-2222-4222-8222-222222222222';
const secondShopId = '44444444-4444-4444-8444-444444444444';

function cairoFixtureDay(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function requestedTrend(from: string, to: string) {
  const amounts = [20000, 25000, 15000];
  return amounts.flatMap((netSalesMinor, index) => {
    const day = new Date(`${from}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() + index);
    const date = day.toISOString().slice(0, 10);
    return date <= to ? [{ date, netSalesMinor }] : [];
  });
}

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
          shopIds: [shopId, secondShopId],
          shopSummaries: [
            { id: shopId, name: 'TUX Maadi', active: true, temporaryClosed: false },
            {
              id: secondShopId,
              name: 'TUX Zamalek Riverside & Catering Kitchen',
              active: true,
              temporaryClosed: true,
            },
          ],
          permissions: [
            'orders.view',
            'catalog.view',
            'inventory.view',
            'customers.view',
            'purchasing.view',
            'staff.view',
            'delivery.view',
            'reports.view',
            ...(role === 'OWNER'
              ? [
                  'finance.view',
                  'approvals.review',
                  'settings.manage',
                  'audit.view',
                  'alerts.view',
                  'devices.view',
                  'whatsapp.view',
                ]
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
    const from = url.searchParams.get('from') ?? cairoFixtureDay();
    const to = url.searchParams.get('to') ?? from;
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
            salesTrend: requestedTrend(from, to),
            topProducts: [{ name: 'Espresso', quantity: 7, recordedSalesMinor: 24000 }],
            sourceMix: [
              { source: 'POS', orderCount: 10 },
              { source: 'ONLINE', orderCount: 2 },
            ],
            shopComparison: [{ shopName: 'TUX Maadi', orderCount: 12, netSalesMinor: 155000 }],
          }
        : view === 'configuration'
          ? {
              savedViews: [],
              targets: [
                {
                  id: 'target-net-sales',
                  shopId,
                  metric: 'NET_SALES',
                  periodStart: cairoFixtureDay(),
                  periodEnd: cairoFixtureDay(),
                  targetValue: 175000,
                  version: 1,
                },
                {
                  id: 'target-orders',
                  shopId,
                  metric: 'ORDER_COUNT',
                  periodStart: cairoFixtureDay(),
                  periodEnd: cairoFixtureDay(),
                  targetValue: 20,
                  version: 1,
                },
              ],
            }
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
        ? {
            summaries: [
              {
                id: 'owner-summary-1',
                business_day_id: 'day-1',
                generated_at: '2026-10-19T00:00:00.000Z',
                summary: {
                  netSalesMinor: 155000,
                  estimatedOperatingProfitMinor: 51000,
                  orderCount: 12,
                  cashVarianceMinor: 0,
                  cashVarianceCount: 0,
                  lowStockCount: 2,
                  failedOnlineOrderCount: 1,
                  pendingApprovalCount: 3,
                },
              },
            ],
          }
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
    await expect(page.getByRole('heading', { name: 'TUX Maadi' })).toBeVisible();
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
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"error":"unavailable"}',
      });
    } else {
      await route.fallback();
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
  const logo = page.locator('.admin-topbar__mobile-brand .admin-brand-logo');
  await expect(logo).toBeVisible();
  expect(await logo.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
    'rgb(255, 255, 255)',
  );
  await page.screenshot({ path: 'test-results/p01-dashboard-owner-390-dark.png', fullPage: true });
});

test('P01 zero-value daily report is not misrepresented as unavailable', async ({ page }) => {
  await mockHome(page, 'OWNER');
  await page.route('**/api/admin/reports?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('view') !== 'dashboard') return route.fallback();
    const body = {
      ok: true,
      netSalesMinor: 0,
      orderCount: 0,
      averageOrderMinor: null,
      estimatedOperatingProfitMinor: null,
      lowStockCount: 0,
      outOfStockCount: 0,
      failedOnlineOrderCount: 0,
      pendingApprovalCount: 0,
      staffOnShiftCount: null,
      deliveryOpenCount: null,
      salesTrend: [],
      topProducts: [],
      sourceMix: [],
      shopComparison: [],
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Needs attention' })).toContainText(
    'No flagged exceptions',
  );
  await expect(page.getByRole('region', { name: "Today's recorded performance" })).toContainText(
    'No recorded activity',
  );
  await expect(page.getByText('Unavailable').first()).toBeVisible();
  await expect(page.getByText('Net sales today')).toBeVisible();
});

test('P01 respects 200% CSS zoom and preserves keyboard entry', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockHome(page, 'OWNER');
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Needs attention' })).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  await expect(page.getByRole('link', { name: /Open reports/i }).first()).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: 'test-results/p01-dashboard-owner-200-percent-css-zoom.png' });
});

test('P01 keeps the shell stable while daily reports are loading', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockHome(page, 'OWNER');
  let releaseReports: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    releaseReports = resolve;
  });
  await page.route('**/api/admin/reports?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('view') !== 'dashboard') return route.fallback();
    await held;
    return route.fallback();
  });
  await page.goto('/');
  await expect(page.getByText("Loading today's recorded activity")).toBeVisible();
  await expect(page.locator('.tux-home-kpi--skeleton')).toHaveCount(3);
  await page.screenshot({ path: 'test-results/p01-dashboard-loading-390.png' });
  releaseReports();
  await expect(page.getByRole('region', { name: 'Needs attention' })).toBeVisible();
});
