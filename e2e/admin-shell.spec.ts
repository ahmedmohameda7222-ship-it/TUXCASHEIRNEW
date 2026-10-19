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
    shopSummaries: [
      { id: 'shop-a', name: 'TUX Maadi', active: true, temporaryClosed: false },
      { id: 'shop-b', name: 'TUX Zamalek', active: true, temporaryClosed: true },
    ],
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

test('OWNER sees authorized real shop names without Settings reads', async ({ page }) => {
  await mockSession(page);
  const settingsReads: string[] = [];
  await page.route('**/api/admin/settings?*', (route) => {
    settingsReads.push(route.request().url());
    return route.fulfill({ status: 403, body: '{}' });
  });
  await page.goto('/');
  const switcher = page.locator('.shop-switcher select');
  await expect(switcher.locator('option[value="shop-a"]')).toHaveText('TUX Maadi');
  await expect(switcher.locator('option[value="shop-b"]')).toHaveText(
    'TUX Zamalek · Temporarily closed',
  );
  expect(settingsReads).toEqual([]);
  await switcher.selectOption('shop-b');
  await expect(switcher).toHaveValue('shop-b');
});

test('restricted multi-shop MANAGER sees only assigned identities', async ({ page }) => {
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
          shopIds: ['shop-b', 'shop-a'],
          shopSummaries: [
            { id: 'shop-a', name: 'TUX Maadi', active: true, temporaryClosed: false },
            { id: 'shop-b', name: 'TUX Zamalek', active: false, temporaryClosed: false },
            {
              id: 'shop-secret',
              name: 'Unauthorized Branch',
              active: true,
              temporaryClosed: false,
            },
          ],
        },
      }),
    }),
  );
  const settingsReads: string[] = [];
  await page.route('**/api/admin/settings?*', (route) => {
    settingsReads.push(route.request().url());
    return route.fulfill({ status: 403, body: '{}' });
  });
  await page.goto('/');
  const switcher = page.locator('.shop-switcher select');
  await expect(switcher.locator('option')).toHaveCount(2);
  await expect(switcher.locator('option[value="shop-a"]')).toHaveText('TUX Maadi');
  await expect(switcher.locator('option[value="shop-b"]')).toHaveText('TUX Zamalek · Inactive');
  await expect(switcher).not.toContainText('Unauthorized Branch');
  expect(settingsReads).toEqual([]);
});
for (const viewport of [
  { name: 'small-phone', width: 320, height: 720 },
  { name: 'narrow-phone', width: 375, height: 844 },
  { name: 'desktop-1280', width: 1280, height: 800 },
]) {
  test(`keeps Admin navigation and layout within ${viewport.name} viewport`, async ({ page }) => {
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

for (const scheme of ['light', 'dark'] as const) {
  test(`captures ${scheme} mode desktop and mobile shell with real labels`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await mockSession(page);
    for (const viewport of [
      { name: 'desktop', width: 1440, height: 900 },
      { name: 'phone', width: 390, height: 844 },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/');
      const shop = page.locator('.shop-switcher select');
      await expect(shop.locator('option[value="shop-a"]')).toHaveText('TUX Maadi');
      await expect(shop.locator('option[value="shop-b"]')).toContainText('TUX Zamalek');
      await page.screenshot({
        path: `test-results/admin-stage1-shell-${scheme}-${viewport.name}.png`,
      });
    }
  });
}

test('200% page zoom keeps the Admin header and shop scope usable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockSession(page);
  await page.goto('/');
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  await expect(page.locator('.shop-switcher select')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/admin-stage1-zoom-200-percent-css.png' });
});

test('P01 secondary routes keep More active while hiding unshipped modules', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockSession(page);
  await page.goto('/staff');
  const mobile = page.locator('[data-admin-mobile-nav]');
  await expect(mobile.getByRole('link', { name: 'More' })).toHaveAttribute('aria-current', 'page');
  await expect(mobile.getByRole('link', { name: 'Home' })).not.toHaveAttribute(
    'aria-current',
    'page',
  );
  await mobile.getByRole('link', { name: 'More' }).click();
  await expect(page.getByRole('heading', { name: 'More' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Staff/ }).first()).toBeVisible();
  await expect(page.getByText('WhatsApp')).toHaveCount(0);
  await expect(page.getByText('Devices / Operations')).toHaveCount(0);
  await expect(page.getByText('Alerts')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/p01-mobile-more-390.png' });
});

test('P01 desktop navigation groups Catalog under Operations and preserves selected route', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockSession(page);
  await page.goto('/catalog/products');
  await expect(page.getByText('Loading management workspace')).toBeHidden();
  const nav = page.locator('[data-admin-desktop-nav]');
  await expect(nav.getByRole('link', { name: 'Catalog' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByText('Operations')).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Catalog' })).toBeVisible();
  await expect(nav.getByText('WhatsApp')).toHaveCount(0);
  await expect(nav.getByText('Devices / Operations')).toHaveCount(0);
  await expect(nav.getByText('Alerts')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/p01-desktop-sidebar-catalog-active.png' });
});

test('P01 future-module deep links are honest instead of acting shipped', async ({ page }) => {
  await mockSession(page);
  await page.goto('/alerts');
  await expect(page.getByText('Planned capability')).toBeVisible();
  await expect(page.getByText(/not available in the current TUX Admin release/i)).toBeVisible();
});

test('P01 keeps shop selection in memory and rejects revoked assignment on reload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockSession(page);
  await page.goto('/');
  const shop = page.locator('.shop-switcher select');
  await shop.selectOption('shop-b');
  await expect(shop).toHaveValue('shop-b');
  await expect(page.getByRole('region', { name: 'Current business context' })).toContainText(
    'TUX Zamalek',
  );
  await page.screenshot({ path: 'test-results/p01-shop-selection-390.png' });

  // Shop selection is memory-only: reloading requires revalidating the
  // authenticated principal and selecting a currently permitted shop.
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
          shopIds: ['shop-a'],
          shopSummaries: [
            { id: 'shop-a', name: 'TUX Maadi', active: true, temporaryClosed: false },
          ],
        },
      }),
    }),
  );
  await page.reload();
  await expect(page.getByRole('region', { name: 'Current business context' })).toContainText(
    'TUX Maadi',
  );
  await expect(page.locator('.shop-switcher select')).toHaveCount(0);
  await expect(page.getByText('TUX Zamalek')).toHaveCount(0);
});
