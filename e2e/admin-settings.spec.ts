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
        channel: String(command.channel),
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
        body: JSON.stringify({ ok: true, publishedSettingsVersion: settingsVersion }),
      });
      return;
    }

    throw new Error(`Unexpected command ${String(command.type)}`);
  });

  return { commands };
}

test.describe('Admin settings workspace', () => {
  test('edits checkout and receipt overrides, order types, payments, reasons, then publishes', async ({
    page,
  }) => {
    const { commands } = await mockSettings(page);
    await page.goto('/settings/checkout');

    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
    await page.getByLabel('Minimum order (minor)').fill('4200');
    await page.getByRole('button', { name: 'Save minimum order' }).click();
    await expect.poll(() => commands.length).toBeGreaterThan(0);
    expect(commands.at(-1)).toMatchObject({
      type: 'setting.override.upsert',
      shopId,
      settingKey: 'checkout.minimumOrderMinor',
      value: 4200,
      expectedVersion: null,
    });

    await page.getByLabel('Tax / VAT (basis points)').fill('1500');
    await page.getByRole('button', { name: 'Save tax / VAT' }).click();
    await expect.poll(() => commands.length).toBeGreaterThan(1);
    expect(commands.at(-1)).toMatchObject({
      type: 'setting.override.upsert',
      settingKey: 'checkout.taxBps',
      value: 1500,
      expectedVersion: null,
    });

    await page.goto('/settings/receipts');
    await page.getByLabel('Order prefix').fill('TUXM-');
    await page.getByRole('button', { name: 'Save order prefix' }).click();
    await expect.poll(() => commands.length).toBeGreaterThan(2);
    expect(commands.at(-1)).toMatchObject({
      type: 'setting.override.upsert',
      settingKey: 'receipt.orderPrefix',
      value: 'TUXM-',
      expectedVersion: 4,
    });

    await page.goto('/settings/order-types');
    await page.getByLabel('Name').fill('Pickup');
    await page.getByRole('button', { name: 'Save order type' }).click();
    await expect.poll(() => commands.length).toBeGreaterThan(3);
    expect(commands.at(-1)).toMatchObject({ type: 'order-type.update', name: 'Pickup' });

    await page.goto('/settings/payments');
    await page.getByLabel('Display name').fill('Till cash');
    await page.getByRole('button', { name: 'Save payment method' }).click();
    await expect.poll(() => commands.length).toBeGreaterThan(4);
    expect(commands.at(-1)).toMatchObject({
      type: 'payment-method.update',
      displayName: 'Till cash',
    });

    await page.goto('/settings/reason-codes');
    await page.getByLabel('Reason label').fill('Customer changed their mind');
    await page.getByRole('button', { name: 'Save reason' }).click();
    await expect.poll(() => commands.length).toBeGreaterThan(5);
    expect(commands.at(-1)).toMatchObject({
      type: 'reason-code.upsert',
      reasonCodeId: 'reason-1',
      label: 'Customer changed their mind',
      active: true,
    });

    await page.getByRole('button', { name: 'Publish settings' }).click();
    await expect.poll(() => commands.length).toBeGreaterThan(6);
    expect(commands.at(-1)).toMatchObject({ type: 'settings.publish', expectedSettingsVersion: 7 });
  });
});
