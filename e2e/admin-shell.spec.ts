import { expect, test, type Page } from '@playwright/test';
import { ADMIN_CORE_VIEWPORTS } from './adminViewports';

const ownerSession = {
  principal: {
    employeeId: 'employee-e2e',
    businessId: 'business-e2e',
    role: 'OWNER',
    permissions: [
      'orders.view',
      'catalog.view',
      'inventory.view',
      'customers.view',
      'purchasing.view',
      'staff.view',
      'delivery.view',
      'finance.view',
      'reports.view',
      'alerts.view',
      'devices.view',
      'whatsapp.view',
      'settings.manage',
      'audit.view',
    ],
    shopIds: ['shop-a', 'shop-b'],
  },
  csrfToken: 'a'.repeat(64),
};

async function mockSession(page: Page) {
  await page.route('**/api/admin/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(ownerSession),
    });
  });
}

for (const viewport of ADMIN_CORE_VIEWPORTS) {
  test(`renders the adaptive Admin shell at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await mockSession(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
    await expect(page.locator('main#main-content')).toBeVisible();
    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(horizontalOverflow).toBe(false);
    const mobile = page.locator('[data-admin-mobile-nav]');
    const desktop = page.locator('[data-admin-desktop-nav]');
    if (viewport.name === 'phone') {
      await expect(mobile).toBeVisible();
      await expect(desktop).toBeHidden();
      for (const label of ['Home', 'Orders', 'Catalog', 'Inventory', 'More']) {
        const tabLabel = mobile.getByText(label);
        await expect(tabLabel).toBeVisible();
        expect(
          await tabLabel.evaluate((element) =>
            Number.parseFloat(getComputedStyle(element).fontSize),
          ),
        ).toBeGreaterThanOrEqual(12);
      }
    } else {
      await expect(mobile).toBeHidden();
      await expect(desktop).toBeVisible();
      if (viewport.name === 'tablet') {
        await expect(desktop.getByText('Home', { exact: true })).toBeVisible();
        await expect(desktop.getByText('Settings', { exact: true })).toBeVisible();
        const sidebarWidth = await desktop.evaluate(
          (element) => element.getBoundingClientRect().width,
        );
        expect(sidebarWidth).toBeGreaterThanOrEqual(200);
      }
    }
    // CI artifact proves the actual rendered viewport at this exact PR head.
    await page.screenshot({
      path: `test-results/admin-stage1-shell-${viewport.name}.png`,
      fullPage: true,
    });
  });
}

test('uses actual authorized shop names while keeping UUID scope values', async ({ page }) => {
  await mockSession(page);
  const requestedShopIds: string[] = [];
  await page.route('**/api/admin/settings?*', async (route) => {
    const shopId = new URL(route.request().url()).searchParams.get('shopId');
    expect(['shop-a', 'shop-b']).toContain(shopId);
    requestedShopIds.push(shopId!);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        shop: {
          id: shopId,
          name: shopId === 'shop-a' ? 'TUX Maadi' : 'TUX Zamalek',
          active: true,
          temporaryClosed: shopId === 'shop-b',
        },
      }),
    });
  });
  await page.goto('/');
  const switcher = page.locator('.shop-switcher select');
  await expect(switcher.locator('option[value="shop-a"]')).toHaveText('TUX Maadi');
  await expect(switcher.locator('option[value="shop-b"]')).toHaveText(
    'TUX Zamalek · Temporarily closed',
  );
  expect(requestedShopIds.sort()).toEqual(['shop-a', 'shop-b']);
  await switcher.selectOption('shop-b');
  await expect(switcher).toHaveValue('shop-b');
});

test('does not request shop metadata without settings read permission', async ({ page }) => {
  await page.route('**/api/admin/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...ownerSession,
        principal: {
          ...ownerSession.principal,
          role: 'MANAGER',
          permissions: ['orders.view'],
        },
      }),
    }),
  );
  const unauthorizedReads: string[] = [];
  await page.route('**/api/admin/settings?*', (route) => {
    unauthorizedReads.push(route.request().url());
    return route.fulfill({ status: 403, body: '{}' });
  });
  await page.goto('/');
  await expect(page.locator('.shop-switcher select')).toBeVisible();
  await expect(page.locator('.shop-switcher option')).toHaveCount(2);
  expect(unauthorizedReads).toEqual([]);
});

for (const viewport of [
  { name: 'small-phone', width: 320, height: 720 },
  { name: 'narrow-phone', width: 375, height: 844 },
  { name: 'desktop-1280', width: 1280, height: 800 },
]) {
  test(`keeps Admin navigation and layout within ${viewport.name} viewport`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await mockSession(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
    await expect(page.locator('#main-content')).toBeVisible();
    const phone = viewport.width < 768;
    if (phone) {
      await expect(page.locator('[data-admin-mobile-nav]')).toBeVisible();
      await expect(page.locator('[data-admin-desktop-nav]')).toBeHidden();
    } else {
      await expect(page.locator('[data-admin-mobile-nav]')).toBeHidden();
      await expect(page.locator('[data-admin-desktop-nav]')).toBeVisible();
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    ).toBe(false);
    await page.screenshot({
      path: `test-results/admin-stage1-shell-${viewport.name}.png`,
      fullPage: true,
    });
  });
}
