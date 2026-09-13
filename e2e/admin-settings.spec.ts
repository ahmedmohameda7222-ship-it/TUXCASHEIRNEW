import type { AdminPaymentMethodDetail } from '@tux/admin-contracts';
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

// Keep mutable payment fixtures aligned with the published Admin settings contract.
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
  let paymentMethod: AdminPaymentMethodDetail = {
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
  const businessDefaults = [
    { key: 'checkout.minimumOrderMinor', value: 3000, version: 1 },
    { key: 'checkout.serviceChargeBps', value: 500, version: 1 },
    { key: 'checkout.taxBps', value: 1400, version: 1 },
    { key: 'checkout.requireCustomerPhone', value: false, version: 1 },
    { key: 'checkout.allowScheduledOrders', value: false, version: 1 },
    { key: 'receipt.footer', value: 'Thank you', version: 2 },
    { key: 'receipt.orderPrefix', value: 'TUX-', version: 1 },
    { key: 'receipt.sequenceStart', value: 1, version: 1 },
    { key: 'receipt.sequenceResetPolicy', value: 'BUSINESS_DAY', version: 1 },
  ];
  const shopOverrides: { key: string; value: unknown; version: number }[] = [
    { key: 'receipt.orderPrefix', value: 'MD-', version: 4 },
  ];
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
          businessDefaults,
          shopOverrides,
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

    if (command.type === 'setting.override.upsert') {
      const settingKey = String(command.settingKey);
      const current = shopOverrides.find((row) => row.key === settingKey);
      expect(command.expectedVersion).toBe(current?.version ?? null);
      if (current) {
        current.value = command.value;
        current.version += 1;
      } else {
        shopOverrides.push({ key: settingKey, value: command.value, version: 1 });
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          version: shopOverrides.find((row) => row.key === settingKey)!.version,
        }),
      });
      return;
    }

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
        behavior: String(command.behavior),
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
      paymentMethod = {
        ...paymentMethod,
        displayName: String(command.displayName),
        active: Boolean(command.active),
        sortOrder: Number(command.sortOrder),
        channel: String(command.channel) as AdminPaymentMethodDetail['channel'],
        requiresReference: Boolean(command.requiresReference),
        manualConfirmationRequired: Boolean(command.manualConfirmationRequired),
        refundAllowed: Boolean(command.refundAllowed),
        integrationReference:
          command.integrationReference === null ? null : String(command.integrationReference),
        editVersion: paymentMethod.editVersion + 1,
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, editVersion: paymentMethod.editVersion }),
      });
      return;
    }

    if (command.type === 'reason-code.upsert') {
      expect(command).toMatchObject({
        shopId,
        reasonCodeId: 'reason-1',
        key: 'CUSTOMER_CHANGED_MIND',
        family: 'CANCELLATION',
        expectedVersion: 4,
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, reasonCodeId: 'reason-1', version: 5 }),
      });
      return;
    }

    if (command.type === 'settings.publish') {
      expect(command).toEqual({
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
          operationsConfigurationVersion: 20 + settingsVersion,
        }),
      });
      return;
    }

    if (command.type === 'shop.delete-or-archive') {
      expect(command).toEqual({ type: 'shop.delete-or-archive', shopId });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, action: 'ARCHIVED' }),
      });
      return;
    }

    throw new Error(`Unexpected settings command ${JSON.stringify(command)}`);
  });

  return { commands };
}

test('edits checkout and receipt overrides with CAS, then publishes settings', async ({ page }) => {
  const { commands } = await mockSettings(page);

  await page.goto('/settings/checkout');
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();

  await page.getByLabel('Tax / VAT (bps)').fill('1600');
  await page.getByRole('button', { name: 'Save Tax / VAT (bps)' }).click();

  await expect.poll(() => commands.length).toBeGreaterThanOrEqual(1);
  expect(commands[0]).toMatchObject({
    type: 'setting.override.upsert',
    shopId,
    settingKey: 'checkout.taxBps',
    value: 1600,
    expectedVersion: null,
  });

  await page.getByRole('button', { name: 'Receipts' }).click();
  await page.getByLabel('Order prefix').fill('MD2-');
  await page.getByRole('button', { name: 'Save Order prefix' }).click();

  await expect.poll(() => commands.length).toBeGreaterThanOrEqual(2);
  expect(commands[1]).toMatchObject({
    type: 'setting.override.upsert',
    shopId,
    settingKey: 'receipt.orderPrefix',
    value: 'MD2-',
    expectedVersion: 4,
  });

  await page.getByRole('button', { name: 'Publish settings' }).click();
  await expect.poll(() => commands.length).toBeGreaterThanOrEqual(3);
  expect(commands[2]).toEqual({
    type: 'settings.publish',
    shopId,
    expectedSettingsVersion: 7,
  });
});

test('edits payment flags and preserves the settings CAS boundary', async ({ page }) => {
  const { commands } = await mockSettings(page);

  await page.goto('/settings/payments');
  await expect(page.getByRole('heading', { name: 'Payments' })).toBeVisible();

  await page.getByRole('button', { name: 'Edit Cash' }).click();
  await page.getByLabel('Reference required').check();
  await page.getByLabel('Manual confirmation').check();
  await page.getByRole('button', { name: 'Save payment method' }).click();

  await expect.poll(() => commands.length).toBeGreaterThanOrEqual(1);
  expect(commands[0]).toMatchObject({
    type: 'payment-method.update',
    shopId,
    paymentMethodId,
    expectedSettingsVersion: 7,
    expectedEditVersion: 5,
    requiresReference: true,
    manualConfirmationRequired: true,
  });
});

test('deactivates an existing reason code through the trusted settings command', async ({
  page,
}) => {
  const { commands } = await mockSettings(page);

  await page.goto('/settings/reason-codes');
  await expect(page.getByRole('heading', { name: 'Configured operational reasons' })).toBeVisible();
  await page.getByLabel('CUSTOMER_CHANGED_MIND reason status').selectOption('inactive');
  await page.getByRole('button', { name: 'Save CUSTOMER_CHANGED_MIND' }).click();

  await expect.poll(() => commands.length).toBeGreaterThanOrEqual(1);
  expect(commands[0]).toMatchObject({
    type: 'reason-code.upsert',
    shopId,
    reasonCodeId: 'reason-1',
    key: 'CUSTOMER_CHANGED_MIND',
    family: 'CANCELLATION',
    active: false,
    expectedVersion: 4,
  });
});

test('confirms archive before routing shop lifecycle management through the trusted BFF', async ({
  page,
}) => {
  const { commands } = await mockSettings(page);
  page.once('dialog', (dialog) => dialog.accept());

  await page.goto('/settings/shop');
  await page.getByRole('button', { name: 'Archive / delete unused shop' }).click();

  await expect.poll(() => commands.length).toBeGreaterThanOrEqual(1);
  expect(commands[0]).toEqual({ type: 'shop.delete-or-archive', shopId });
});
