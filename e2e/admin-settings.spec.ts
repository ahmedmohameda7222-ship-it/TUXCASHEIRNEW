import { expect, test, type Page, type Route } from '@playwright/test';

const shopId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const csrfToken = 's'.repeat(64);

const ownerSession = {
  principal: {
    employeeId: '33333333-3333-4333-8333-333333333333',
    businessId: '44444444-4444-4444-8444-444444444444',
    role: 'OWNER',
    permissions: ['settings.manage'],
    shopIds: [shopId],
  },
  csrfToken,
};

async function mockSettings(page: Page) {
  let settingsVersion = 7;
  const commands: Record<string, unknown>[] = [];

  await page.route('**/api/admin/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(ownerSession),
    });
  });

  await page.route('**/api/admin/settings**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'GET') {
      expect(url.searchParams.get('shopId')).toBe(shopId);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          shop: {
            id: shopId,
            name: 'TUX Maadi',
            lifecycleState: 'ACTIVE',
            active: true,
            address: 'Road 9, Maadi',
            contactPhone: '+201000000000',
            latitude: 29.9602,
            longitude: 31.2569,
            timezone: 'Africa/Cairo',
            temporaryClosed: false,
            onlineOrdersPaused: false,
          },
          settingsVersion,
          businessDefaults: [
            { key: 'receipt.footer', value: 'Thank you', version: 2 },
            { key: 'receipt.orderPrefix', value: 'TUX-', version: 1 },
            { key: 'receipt.sequenceStart', value: 1, version: 1 },
          ],
          shopOverrides: [{ key: 'receipt.orderPrefix', value: 'MD-', version: 4 }],
          orderTypes: [
            { id: 'ot-1', name: 'Take Away', behavior: 'TAKE_AWAY', active: true, sortOrder: 10 },
          ],
          paymentMethods: [
            {
              id: 'pm-1',
              displayName: 'Cash',
              logicType: 'CASH',
              requiresReconciliation: true,
              active: true,
              sortOrder: 10,
              channel: 'BOTH',
              requiresReference: false,
              manualConfirmationRequired: false,
              refundAllowed: true,
              integrationReference: null,
            },
          ],
          deliveryZones: [],
          reasonCodes: [
            {
              id: 'reason-1',
              scope: 'SHOP',
              key: 'CUSTOMER_CHANGED_MIND',
              family: 'CANCELLATION',
              label: 'Customer changed mind',
              active: true,
              version: 4,
            },
          ],
          weeklyHours: [],
          specialHours: [],
        }),
      });
      return;
    }

    expect(request.method()).toBe('POST');
    expect(request.headers()['x-tux-admin-csrf']).toBe(csrfToken);
    const command = request.postDataJSON() as Record<string, unknown>;
    commands.push(command);
    expect(command).toMatchObject({
      type: 'settings.publish',
      shopId,
      expectedSettingsVersion: settingsVersion,
    });
    settingsVersion += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        settingsVersion,
        operationsConfigurationVersion: 12,
      }),
    });
  });

  return { commands };
}

test('settings route loads the concrete shop workspace and publishes through the trusted BFF', async ({
  page,
}) => {
  const fixture = await mockSettings(page);
  await page.goto('/settings');

  await expect(page.getByRole('heading', { name: 'TUX Maadi' })).toBeVisible();
  await expect(page.getByText('Live settings version 7')).toBeVisible();
  await expect(page.getByText('MD-')).toBeVisible();
  await expect(page.getByText('Customer changed mind')).toBeVisible();

  await page.getByRole('button', { name: 'Publish settings' }).click();

  await expect(page.getByText('Live settings version 8')).toBeVisible();
  expect(fixture.commands).toHaveLength(1);
});
