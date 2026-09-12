import { expect, test, type Page, type Route } from '@playwright/test';

const shopId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const orderTypeId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const paymentMethodId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
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
  let orderType = {
    id: orderTypeId,
    name: 'Take Away',
    behavior: 'TAKE_AWAY',
    active: true,
    sortOrder: 10,
    editVersion: 3,
  };
  let paymentMethod = {
    id: paymentMethodId,
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
    editVersion: 5,
  };
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
          orderTypes: [orderType],
          paymentMethods: [paymentMethod],
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

    if (command.type === 'order-type.update') {
      expect(command).toMatchObject({
        shopId,
        orderTypeId,
        expectedSettingsVersion: settingsVersion,
        expectedEditVersion: orderType.editVersion,
      });
      orderType = {
        ...orderType,
        name: String(command.name),
        behavior: command.behavior as typeof orderType.behavior,
        active: Boolean(command.active),
        sortOrder: Number(command.sortOrder),
        editVersion: orderType.editVersion + 1,
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, editVersion: orderType.editVersion }),
      });
      return;
    }

    if (command.type === 'payment-method.update') {
      expect(command).toMatchObject({
        shopId,
        paymentMethodId,
        expectedSettingsVersion: settingsVersion,
        expectedEditVersion: paymentMethod.editVersion,
      });
      expect(command).not.toHaveProperty('logicType');
      expect(command).not.toHaveProperty('requiresReconciliation');
      paymentMethod = {
        ...paymentMethod,
        displayName: String(command.displayName),
        active: Boolean(command.active),
        sortOrder: Number(command.sortOrder),
        channel: command.channel as typeof paymentMethod.channel,
        requiresReference: Boolean(command.requiresReference),
        manualConfirmationRequired: Boolean(command.manualConfirmationRequired),
        refundAllowed: Boolean(command.refundAllowed),
        editVersion: paymentMethod.editVersion + 1,
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, editVersion: paymentMethod.editVersion }),
      });
      return;
    }

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

test('settings route edits canonical order and payment configuration before publish', async ({ page }) => {
  const fixture = await mockSettings(page);
  await page.goto('/settings');

  await page.getByRole('button', { name: 'Order types' }).click();
  await page.getByRole('button', { name: 'Edit Take Away' }).click();
  await page.getByLabel('Order type name').fill('Pick up');
  await page.getByLabel('Order type active').uncheck();
  await page.getByRole('button', { name: 'Save order type' }).click();
  await expect(page.getByText('Pick up')).toBeVisible();
  await expect(page.getByText('Inactive')).toBeVisible();

  await page.getByRole('button', { name: 'Payments' }).click();
  await page.getByRole('button', { name: 'Edit Cash' }).click();
  await page.getByLabel('Payment method name').fill('Front Cash');
  await page.getByLabel('Payment channel').selectOption('POS');
  await page.getByLabel('Reference required').check();
  await page.getByLabel('Manual confirmation').check();
  await page.getByRole('button', { name: 'Save payment method' }).click();
  await expect(page.getByText('Front Cash')).toBeVisible();
  await expect(page.getByText('Reference required')).toBeVisible();
  await expect(page.getByText('Manual confirmation')).toBeVisible();

  await page.getByRole('button', { name: 'Publish settings' }).click();
  await expect(page.getByText('Live settings version 8')).toBeVisible();

  expect(fixture.commands).toHaveLength(3);
  expect(fixture.commands.map((command) => command.type)).toEqual([
    'order-type.update',
    'payment-method.update',
    'settings.publish',
  ]);
});
