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
  });
}
