import { expect, test, type Page } from '@playwright/test';

const SHOP_A = '11111111-1111-4111-8111-111111111111';
const SHOP_B = '22222222-2222-4222-8222-222222222222';
const ownerSession = {
  principal: {
    employeeId: '33333333-3333-4333-8333-333333333333',
    businessId: '44444444-4444-4444-8444-444444444444',
    role: 'OWNER',
    permissions: ['orders.view', 'alerts.view', 'approvals.review', 'inventory.view'],
    shopIds: [SHOP_A, SHOP_B],
    shopSummaries: [
      { id: SHOP_A, name: 'TUX Maadi', active: true, temporaryClosed: false },
      { id: SHOP_B, name: 'TUX Zamalek', active: true, temporaryClosed: false },
    ],
  },
  csrfToken: 'a'.repeat(64),
};

const alerts = [
  {
    id: 'alert_11111111111111111111111111111111',
    businessId: ownerSession.principal.businessId,
    shopId: SHOP_A,
    shopName: 'TUX Maadi',
    source: 'APPROVAL',
    severity: 'WARNING',
    title: 'Inventory adjustment needs review',
    description: 'Review the requested adjustment before deciding.',
    observedAt: '2026-10-22T08:55:00.000Z',
    entityId: '55555555-5555-4555-8555-555555555555',
    href: '/approvals',
    state: 'ACTIVE',
  },
  {
    id: 'alert_22222222222222222222222222222222',
    businessId: ownerSession.principal.businessId,
    shopId: SHOP_A,
    shopName: 'TUX Maadi',
    source: 'INVENTORY',
    severity: 'CRITICAL',
    title: 'Tomatoes are out of stock',
    description: 'Available 0 kg; suggested order 10000 kg.',
    observedAt: '2026-10-22T08:50:00.000Z',
    entityId: '66666666-6666-4666-8666-666666666666',
    href: 'https://evil.example/steal',
    state: 'ACTIVE',
  },
] as const;

async function mockAdmin(
  page: Page,
  options: {
    session?: typeof ownerSession;
    unavailableSources?: string[];
    failShop?: string;
  } = {},
) {
  const activeSession = options.session ?? ownerSession;
  await page.route('**/api/admin/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(activeSession),
    }),
  );
  await page.route('**/api/admin/alerts?*', (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('shopId') === options.failShop) {
      return route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'shop_forbidden' }),
      });
    }
    const source = url.searchParams.get('source');
    const severity = url.searchParams.get('severity');
    const rows = alerts.filter((row) => {
      const sourcePermitted =
        row.source !== 'APPROVAL' ||
        activeSession.principal.permissions.includes('approvals.review');
      return (
        sourcePermitted &&
        (!source || row.source === source) &&
        (!severity || row.severity === severity)
      );
    });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        rows,
        nextCursor: null,
        asOf: '2026-10-22T09:00:00.000Z',
        scopeLabel: 'TUX Maadi',
        unavailableSources: options.unavailableSources ?? [],
      }),
    });
  });
}

const widths = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 375, height: 844 },
  { width: 320, height: 720 },
] as const;

for (const viewport of widths) {
  test(`renders source-backed Alerts without overflow at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await mockAdmin(page);
    await page.goto('/alerts');
    await expect(page.getByRole('heading', { name: 'Alerts' })).toBeVisible();
    await page.locator('.shop-switcher select').selectOption('__all__');
    await expect(page.getByText('Select a shop')).toBeVisible();
    await page.locator('.shop-switcher select').selectOption(SHOP_A);
    await expect(page.getByText('2 authorized alerts')).toBeVisible();
    await expect(page.getByText('Inventory adjustment needs review')).toBeVisible();
    await expect(page.getByText('Tomatoes are out of stock')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `artifacts/final/p08/alerts-${viewport.width}x${viewport.height}.png`,
      fullPage: true,
    });
  });
}

test('filters by source and severity, refreshes accessibly, and clamps deep links', async ({
  page,
}) => {
  const requestedUrls: string[] = [];
  page.on('pageerror', (error) => console.error('alerts page error', error));
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('alerts console error', message.text());
  });
  await mockAdmin(page);
  page.on('request', (request) => {
    if (request.url().includes('/api/admin/alerts')) requestedUrls.push(request.url());
  });
  await page.goto('/alerts');
  await page.locator('.shop-switcher select').selectOption(SHOP_A);
  await page.getByLabel('Source').selectOption('INVENTORY');
  await page.getByLabel('Severity').selectOption('CRITICAL');
  await expect(page.getByText('1 authorized alert')).toBeVisible();
  await expect(page.getByText('Tomatoes are out of stock')).toBeVisible();
  await expect
    .poll(() =>
      requestedUrls.some(
        (url) => url.includes('source=INVENTORY') && url.includes('severity=CRITICAL'),
      ),
    )
    .toBe(true);
  const action = page.getByRole('link', { name: 'Open Inventory' });
  await expect(action).toHaveAttribute('href', '/inventory');
  await page.getByRole('button', { name: 'Refresh alerts' }).focus();
  await expect(page.getByRole('button', { name: 'Refresh alerts' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Refreshed/)).toBeVisible();
});

test('distinguishes unavailable sources from a healthy empty result', async ({ page }) => {
  await mockAdmin(page, { unavailableSources: ['APPROVAL'] });
  await page.goto('/alerts');
  await page.locator('.shop-switcher select').selectOption(SHOP_A);
  await page.getByLabel('Source').selectOption('APPROVAL');
  await expect(page.getByRole('alert')).toContainText('Approval data is unavailable');
  await expect(page.getByText('No actionable alerts')).toHaveCount(0);
});

test('keeps restricted and denied roles inside their permissions', async ({ page }) => {
  const managerSession = {
    ...ownerSession,
    principal: {
      ...ownerSession.principal,
      role: 'MANAGER',
      permissions: ['alerts.view', 'inventory.view'],
      shopIds: [SHOP_A],
      shopSummaries: [ownerSession.principal.shopSummaries[0]],
    },
  } as typeof ownerSession;
  await mockAdmin(page, { session: managerSession });
  await page.goto('/alerts');
  await expect(page.getByRole('heading', { name: 'Alerts' })).toBeVisible();
  await expect(page.getByText('Tomatoes are out of stock')).toBeVisible();

  await page.unrouteAll({ behavior: 'wait' });
  const deniedSession = {
    ...ownerSession,
    principal: { ...managerSession.principal, permissions: ['orders.view'] },
  } as typeof ownerSession;
  await mockAdmin(page, { session: deniedSession });
  await page.goto('/alerts');
  await expect(page.getByRole('heading', { name: 'Not available' })).toBeVisible();
  await expect(page.locator('text=Tomatoes are out of stock')).toHaveCount(0);
});

test('shows a scoped error for a forbidden shop without leaking rows', async ({ page }) => {
  await mockAdmin(page, { failShop: SHOP_B });
  await page.goto('/alerts');
  await page.locator('.shop-switcher select').selectOption(SHOP_B);
  await expect(page.getByRole('alert')).toContainText('Alerts could not be loaded');
  await expect(page.getByText('Inventory adjustment needs review')).toHaveCount(0);
});

test('cold and warm routes own the same styles and remain discoverable from More', async ({
  page,
}) => {
  await mockAdmin(page);
  await page.goto('/alerts');
  await page.locator('.shop-switcher select').selectOption(SHOP_A);
  const cold = await page
    .locator('.admin-alert-card')
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return `${style.display}|${style.borderRadius}|${style.padding}`;
    });
  await page.goto('/orders');
  await page.goto('/more');
  await page.locator('.admin-more-card').filter({ hasText: 'Alerts' }).click();
  await page.locator('.shop-switcher select').selectOption(SHOP_A);
  const warm = await page
    .locator('.admin-alert-card')
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return `${style.display}|${style.borderRadius}|${style.padding}`;
    });
  expect(warm).toBe(cold);
});

for (const viewport of [widths[0], widths[3]]) {
  test(`renders Alerts in dark theme at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize(viewport);
    await mockAdmin(page);
    await page.goto('/alerts');
    await page.locator('.shop-switcher select').selectOption(SHOP_A);
    await expect(page.locator('.admin-alert-card').first()).toBeVisible();
    await page.screenshot({
      path: `artifacts/final/p08/alerts-dark-${viewport.width}x${viewport.height}.png`,
      fullPage: true,
    });
  });
}
