import { expect, test } from '@playwright/test';

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

async function mockSession(page: import('@playwright/test').Page) {
  await page.route('**/api/admin/session', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ownerSession) });
  });
}

for (const viewport of [
  { name: 'phone', width: 390, height: 844, mobile: true },
  { name: 'tablet', width: 768, height: 1024, mobile: false },
  { name: 'desktop', width: 1440, height: 1000, mobile: false },
] as const) {
  test(`renders the adaptive Admin shell at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await mockSession(page);
    await page.goto('/');
    await expect(page.getByText('TUX Admin').first()).toBeVisible();
    const mobile = page.locator('[data-admin-mobile-nav]');
    const desktop = page.locator('[data-admin-desktop-nav]');
    if (viewport.mobile) {
      await expect(mobile).toBeVisible();
      await expect(desktop).toBeHidden();
      for (const label of ['Home', 'Orders', 'Catalog', 'Inventory', 'More']) {
        await expect(mobile.getByText(label)).toBeVisible();
      }
    } else {
      await expect(mobile).toBeHidden();
      await expect(desktop).toBeVisible();
    }
  });
}
