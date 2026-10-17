import { expect, test, type Page } from '@playwright/test';

const contextShopId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const createdShopId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const csrfToken = 's'.repeat(64);

async function mockShopCreate(
  page: Page,
  role: 'OWNER' | 'MANAGER',
  permissions: string[],
  commands: Record<string, unknown>[],
) {
  await page.route('**/api/admin/session', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        principal: {
          employeeId: '33333333-3333-4333-8333-333333333333',
          businessId: '44444444-4444-4444-8444-444444444444',
          role,
          permissions,
          shopIds: [contextShopId],
        },
        csrfToken,
      }),
    });
  });

  await page.route('**/api/admin/settings?*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        shop: {
          id: contextShopId,
          name: 'Existing shop',
          lifecycleState: 'ACTIVE',
          lifecycleRevision: 1,
          active: true,
          address: null,
          contactPhone: null,
          latitude: null,
          longitude: null,
          timezone: 'Africa/Cairo',
          temporaryClosed: false,
          onlineOrdersPaused: false,
        },
        settingsVersion: 0,
        businessDefaults: [],
        shopOverrides: [],
        orderTypes: [],
        paymentMethods: [],
        deliveryZones: [],
        reasonCodes: [],
        weeklyHours: [],
        specialHours: [],
      }),
    });
  });

  await page.route('**/api/admin/shop-create', async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['x-tux-admin-csrf']).toBe(csrfToken);
    const command = route.request().postDataJSON() as Record<string, unknown>;
    commands.push(command);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, shopId: createdShopId, idempotentReplay: false }),
    });
  });
}

test('creates a closed-to-orders shop with an idempotent business-scoped command', async ({
  page,
}) => {
  const commands: Record<string, unknown>[] = [];
  await mockShopCreate(page, 'OWNER', ['settings.manage', 'shops.manage'], commands);
  await page.goto('/settings/shop');

  await page.getByRole('button', { name: 'Add new shop' }).click();
  await page.getByLabel('New shop name').fill('New Branch');
  await page.getByLabel('New shop address (optional)').fill('Maadi');
  await page.getByRole('button', { name: 'Create shop', exact: true }).click();

  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({
    contextShopId,
    name: 'New Branch',
    address: 'Maadi',
    contactPhone: null,
  });
  expect(typeof commands[0]?.commandId).toBe('string');
  expect(commands[0]).not.toHaveProperty('businessId');
  expect(commands[0]).not.toHaveProperty('copyCatalog');
  await expect(page.getByRole('status')).toContainText(createdShopId);
  await expect(page.getByRole('status')).toContainText('publish its settings');
});

test('shop-scoped managers cannot start business-wide shop creation', async ({ page }) => {
  await mockShopCreate(page, 'MANAGER', ['settings.manage', 'shops.manage'], []);
  await page.goto('/settings/shop');
  await expect(page.getByRole('button', { name: 'Add new shop' })).toHaveCount(0);
});
