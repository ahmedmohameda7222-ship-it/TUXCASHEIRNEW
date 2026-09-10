import { expect, test } from '@playwright/test';

const staffSession = {
  principal: {
    employeeId: 'staff-e2e',
    businessId: 'business-e2e',
    role: 'STAFF',
    permissions: ['orders.view'],
    shopIds: ['shop-a'],
  },
  csrfToken: 'b'.repeat(64),
};

const ownerSession = {
  principal: {
    employeeId: 'owner-e2e',
    businessId: 'business-e2e',
    role: 'OWNER',
    permissions: ['orders.view', 'catalog.view', 'inventory.view', 'customers.view'],
    shopIds: ['shop-a', 'shop-b'],
  },
  csrfToken: 'c'.repeat(64),
};

test('requires PIN login and preserves staff shop isolation', async ({ page }) => {
  let authenticated = false;
  let submittedPin = '';

  await page.route('**/api/admin/session', async (route) => {
    if (!authenticated) {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'session_required' }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(staffSession) });
  });
  await page.route('**/api/admin/login', async (route) => {
    expect(route.request().method()).toBe('POST');
    const body = route.request().postDataJSON() as { pin?: string };
    submittedPin = body.pin ?? '';
    authenticated = true;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(staffSession) });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Enter PIN' })).toBeVisible();
  const pin = page.getByLabel('PIN');
  await expect(pin).toHaveAttribute('type', 'password');
  await expect(pin).toHaveAttribute('autocomplete', 'off');
  await pin.fill('2468');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  expect(submittedPin).toBe('2468');
  await expect(page.getByLabel('Shop')).toHaveCount(0);
  const desktopNav = page.locator('[data-admin-desktop-nav]');
  await expect(desktopNav.getByText('Orders')).toBeVisible();
  await expect(desktopNav.getByText('Catalog')).toHaveCount(0);
  await expect(desktopNav.getByText('Inventory')).toHaveCount(0);

  await page.goto('/catalog/products');
  await expect(page.getByRole('heading', { name: 'Not available' })).toBeVisible();
});

test('allows All Shops only for an OWNER with mapped shops', async ({ page }) => {
  await page.route('**/api/admin/session', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ownerSession) });
  });

  await page.goto('/');
  const shop = page.getByLabel('Shop');
  await expect(shop).toBeVisible();
  await expect(shop.locator('option')).toHaveCount(3);
  await expect(shop.locator('option').first()).toHaveText('All Shops');
  await shop.selectOption('shop-a');
  await expect(shop).toHaveValue('shop-a');
});
