import type { AdminPaymentMethodDetail } from '@tux/admin-contracts';
import { expect, test, type Page, type Route } from '@playwright/test';
import { ADMIN_CORE_VIEWPORTS } from './adminViewports';

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
async function mockSettings(
  page: Page,
  permissions: string[] = ownerSession.principal.permissions,
  role: 'OWNER' | 'MANAGER' = 'OWNER',
  deliveryZones: {
    id: string;
    name: string;
    active: boolean;
    feeMinor: number;
    sortOrder: number;
  }[] = [],
  authorizedShopIds: string[] = [shopId],
) {
  let settingsVersion = 7;
  let shopLifecycleState: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE';
  let shopLifecycleRevision = 1;
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
  const businessDefaults: { key: string; value: unknown; version: number }[] = [
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
  const paymentZoneCommands: Record<string, unknown>[] = [];
  const paymentZoneRules: { paymentMethodId: string; deliveryZoneId: string; allowed: boolean }[] =
    [];

  await page.route('**/api/admin/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...ownerSession,
        principal: { ...ownerSession.principal, permissions, role, shopIds: authorizedShopIds },
      }),
    });
  });

  await page.route('**/api/admin/payment-zone-rules**', async (route: Route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ rules: paymentZoneRules }),
      });
      return;
    }
    const command = request.postDataJSON() as Record<string, unknown>;
    paymentZoneCommands.push(command);
    const current = paymentZoneRules.find(
      (rule) =>
        rule.paymentMethodId === command.paymentMethodId &&
        rule.deliveryZoneId === command.deliveryZoneId,
    );
    expect(command.expectedAllowed).toBe(current?.allowed ?? null);
    if (current) current.allowed = command.allowed === true;
    else {
      paymentZoneRules.push({
        paymentMethodId: String(command.paymentMethodId),
        deliveryZoneId: String(command.deliveryZoneId),
        allowed: command.allowed === true,
      });
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
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
            lifecycleState: shopLifecycleState,
            lifecycleRevision: shopLifecycleRevision,
            active: shopLifecycleState === 'ACTIVE',
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
          deliveryZones,
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

    if (command.type === 'setting.default.upsert') {
      const settingKey = String(command.settingKey);
      const current = businessDefaults.find((row) => row.key === settingKey);
      expect(command.expectedVersion).toBe(current?.version ?? null);
      if (current) {
        current.value = command.value;
        current.version += 1;
      } else {
        businessDefaults.push({ key: settingKey, value: command.value, version: 1 });
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, version: current?.version ?? 1 }),
      });
      return;
    }

    if (command.type === 'setting.override.restore') {
      const currentIndex = shopOverrides.findIndex((row) => row.key === command.settingKey);
      expect(currentIndex).toBeGreaterThanOrEqual(0);
      expect(command.expectedVersion).toBe(shopOverrides[currentIndex]?.version);
      const [removed] = shopOverrides.splice(currentIndex, 1);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, version: removed?.version }),
      });
      return;
    }

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

    if (command.type === 'payment-method.create') {
      expect(command).toMatchObject({
        shopId,
        expectedSettingsVersion: settingsVersion,
      });
      expect(command).not.toHaveProperty('refundAllowed');
      expect(command).not.toHaveProperty('requiresReconciliation');
      expect(command).not.toHaveProperty('integrationReference');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, paymentMethodId: 'created-method', editVersion: 1 }),
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

    if (command.type === 'shop.lifecycle.update') {
      expect(command).toMatchObject({
        shopId,
        expectedState: shopLifecycleState,
        expectedLifecycleRevision: shopLifecycleRevision,
      });
      const newState = command.targetState;
      expect(['ACTIVE', 'SUSPENDED']).toContain(newState);
      shopLifecycleState = newState as 'ACTIVE' | 'SUSPENDED';
      shopLifecycleRevision += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, lifecycleRevision: shopLifecycleRevision }),
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

  return { commands, paymentZoneCommands };
}

for (const viewport of ADMIN_CORE_VIEWPORTS) {
  test(`keeps Settings navigation and primary actions usable on ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await mockSettings(page);
    await page.goto('/settings/shop');

    await expect(page.getByRole('heading', { name: 'TUX Maadi', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publish settings' })).toBeVisible();
    await page.getByRole('button', { name: 'Checkout' }).click();
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  });
}

test('edits checkout and receipt overrides with CAS, then publishes settings', async ({ page }) => {
  const { commands } = await mockSettings(page);

  await page.goto('/settings/checkout');
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();

  await page.getByLabel('Tax / VAT (%)').fill('16.00');
  await page.getByRole('button', { name: 'Save Tax / VAT (%)' }).click();

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

test('restricts a published payment method for a delivery zone through CAS authority', async ({
  page,
}) => {
  const zoneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const { paymentZoneCommands } = await mockSettings(
    page,
    ownerSession.principal.permissions,
    'OWNER',
    [{ id: zoneId, name: 'Maadi', active: true, feeMinor: 3000, sortOrder: 10 }],
  );
  await page.goto('/settings/checkout');
  await expect(
    page.getByRole('heading', { name: 'Delivery-zone payment restrictions' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Restrict' }).click();
  await expect.poll(() => paymentZoneCommands.length).toBe(1);
  expect(paymentZoneCommands[0]).toEqual({
    type: 'payment-zone.upsert',
    shopId,
    paymentMethodId,
    deliveryZoneId: zoneId,
    allowed: false,
    expectedAllowed: null,
    expectedSettingsVersion: 7,
  });
  await expect(page.getByRole('button', { name: 'Allow' })).toBeVisible();
});

test('creates payment methods with a retry-safe trusted settings command', async ({ page }) => {
  const { commands } = await mockSettings(page);
  await page.goto('/settings/payments');
  await page.getByRole('button', { name: 'Add payment method' }).click();
  await page.getByLabel('New payment method name').fill('Mobile Wallet');
  await page.getByLabel('Payment type').selectOption('DIGITAL');
  await page.getByLabel('New method availability').selectOption('BOTH');
  await page.getByLabel('Require payment reference').check();
  await page.getByRole('button', { name: 'Create payment method' }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({
    type: 'payment-method.create',
    shopId,
    displayName: 'Mobile Wallet',
    logicType: 'DIGITAL',
    channel: 'BOTH',
    requiresReference: true,
    manualConfirmationRequired: false,
    expectedSettingsVersion: 7,
  });
  expect(typeof commands[0]?.commandId).toBe('string');
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

test('changes refund policy with a captured settings and row CAS', async ({ page }) => {
  const { commands } = await mockSettings(page);
  await page.goto('/settings/payments');
  await page.getByRole('button', { name: 'Edit Cash' }).click();
  await page.getByLabel('Refund allowed').uncheck();
  await page.getByRole('button', { name: 'Save payment method' }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({
    type: 'payment-method.update',
    shopId,
    paymentMethodId,
    refundAllowed: false,
    expectedSettingsVersion: 7,
    expectedEditVersion: 5,
  });
});

test('updates refund eligibility for future payments using trusted version-fenced authority', async ({
  page,
}) => {
  const { commands } = await mockSettings(page);
  await page.goto('/settings/payments');
  await page.getByRole('button', { name: 'Edit Cash' }).click();
  await page.getByLabel('Refunds allowed for new payments').uncheck();
  await page.getByRole('button', { name: 'Save payment method' }).click();

  await expect.poll(() => commands.length).toBeGreaterThanOrEqual(1);
  expect(commands[0]).toMatchObject({
    type: 'payment-method.update',
    shopId,
    paymentMethodId,
    refundAllowed: false,
    expectedSettingsVersion: 7,
    expectedEditVersion: 5,
  });
});

test('deactivates an existing reason code through the trusted settings command', async ({
  page,
}) => {
  const { commands } = await mockSettings(page);

  await page.goto('/settings/reason-codes');
  await expect(page.getByRole('heading', { name: 'Configured operational reasons' })).toBeVisible();
  await page.getByLabel('CUSTOMER_CHANGED_MIND reason status').selectOption('inactive');
  await page.getByRole('button', { name: 'Save Customer changed mind' }).click();

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

test('business administrators edit canonical business defaults without changing shop overrides', async ({
  page,
}) => {
  const { commands } = await mockSettings(page);
  await page.goto('/settings/business-defaults');
  await expect(page.getByRole('heading', { name: 'Business defaults' })).toBeVisible();
  await page.getByLabel('Tax / VAT (%)').fill('15.50');
  await page.getByRole('button', { name: 'Save business default: Tax / VAT (%)' }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toEqual({
    type: 'setting.default.upsert',
    shopId,
    settingKey: 'checkout.taxBps',
    value: 1550,
    expectedVersion: 1,
  });
});

test('business default editor uses default value and CAS rather than shop override', async ({
  page,
}) => {
  const { commands } = await mockSettings(page);
  await page.goto('/settings/business-defaults');
  await expect(page.getByLabel('Order prefix')).toHaveValue('TUX-');
  await page.getByLabel('Order prefix').fill('HQ-');
  await page.getByRole('button', { name: 'Save business default: Order prefix' }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toEqual({
    type: 'setting.default.upsert',
    shopId,
    settingKey: 'receipt.orderPrefix',
    value: 'HQ-',
    expectedVersion: 1,
  });
});

test('shop managers cannot access the business defaults editor', async ({ page }) => {
  await mockSettings(page, ['settings.manage'], 'MANAGER');
  await page.goto('/settings/business-defaults');
  await expect(page.getByRole('heading', { name: 'Business defaults' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Business defaults' })).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('business-wide settings');
});

test('restoring inheritance deletes the shop override rather than copying a default', async ({
  page,
}) => {
  const { commands } = await mockSettings(page);
  await page.goto('/settings/receipts');
  await expect(page.getByLabel('Order prefix')).toHaveValue('MD-');
  await page.getByRole('button', { name: 'Restore inherited value: Order prefix' }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toEqual({
    type: 'setting.override.restore',
    shopId,
    settingKey: 'receipt.orderPrefix',
    expectedVersion: 4,
  });
  await expect(page.getByLabel('Order prefix')).toHaveValue('TUX-');
});

test('shop management exposes canonical staff assignment only for staff managers', async ({
  page,
}) => {
  await mockSettings(page, ['settings.manage', 'staff.view', 'staff.manage']);
  await page.goto('/settings/shop');
  const assignmentLink = page.getByRole('link', { name: 'Manage staff assignments' });
  await expect(assignmentLink).toBeVisible();
  await expect(assignmentLink).toHaveAttribute('href', '/staff');
});

test('shop management hides the staff assignment link when staff viewing is forbidden', async ({
  page,
}) => {
  await mockSettings(page, ['settings.manage', 'staff.manage']);
  await page.goto('/settings/shop');
  await expect(page.getByRole('link', { name: 'Manage staff assignments' })).toHaveCount(0);
});

test('shop management does not offer assignment access without staff management authority', async ({
  page,
}) => {
  await mockSettings(page);
  await page.goto('/settings/shop');
  await expect(page.getByRole('link', { name: 'Manage staff assignments' })).toHaveCount(0);
});

test('suspends a shop through version-fenced trusted lifecycle authority', async ({ page }) => {
  const { commands } = await mockSettings(page, ['settings.manage', 'shops.manage']);
  await page.goto('/settings/shop');
  await expect(page.getByRole('button', { name: 'Suspend shop' })).toBeVisible();
  await page.getByRole('button', { name: 'Suspend shop' }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toEqual({
    type: 'shop.lifecycle.update',
    shopId,
    expectedState: 'ACTIVE',
    targetState: 'SUSPENDED',
    expectedLifecycleRevision: 1,
  });
  await expect(page.getByRole('button', { name: 'Reactivate shop' })).toBeVisible();
  await page.getByRole('button', { name: 'Reactivate shop' }).click();
  await expect.poll(() => commands.length).toBe(2);
  expect(commands[1]).toEqual({
    type: 'shop.lifecycle.update',
    shopId,
    expectedState: 'SUSPENDED',
    targetState: 'ACTIVE',
    expectedLifecycleRevision: 2,
  });
});

test('shop lifecycle transitions are unavailable without shop management permission', async ({
  page,
}) => {
  await mockSettings(page);
  await page.goto('/settings/shop');
  await expect(page.getByRole('button', { name: 'Suspend shop' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reactivate shop' })).toHaveCount(0);
});

test('confirms archive before routing shop lifecycle management through the trusted BFF', async ({
  page,
}) => {
  const { commands } = await mockSettings(page);

  await page.goto('/settings/shop');
  await page.getByRole('button', { name: 'Archive / delete unused shop' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Archive TUX Maadi?' });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText('historical records will remain');
  await confirmation.getByRole('button', { name: 'Archive shop' }).click();

  await expect.poll(() => commands.length).toBeGreaterThanOrEqual(1);
  expect(commands[0]).toEqual({ type: 'shop.delete-or-archive', shopId });
});

test('new shop can refresh the authorized shop list without reloading the app', async ({
  page,
}) => {
  await mockSettings(page, ['settings.manage', 'shops.manage']);
  let sessionRequests = 0;
  await page.route('**/api/admin/session', async (route) => {
    sessionRequests += 1;
    await route.fallback();
  });
  const newShopId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  await page.route('**/api/admin/shop-create', async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['x-tux-admin-csrf']).toBe(csrfToken);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, shopId: newShopId, idempotentReplay: false }),
    });
  });

  await page.goto('/settings/shop');
  await page.getByRole('button', { name: 'Add new shop' }).click();
  await page.getByLabel('New shop name').fill('Second Shop');
  await page.getByRole('button', { name: 'Create shop', exact: true }).click();
  await expect(page.getByText(`Shop created: ${newShopId}`, { exact: false })).toBeVisible();
  const requestsBeforeRefresh = sessionRequests;
  await page.getByRole('button', { name: 'Refresh available shops' }).click();
  await expect.poll(() => sessionRequests).toBeGreaterThan(requestsBeforeRefresh);
});

test('previews explicitly selected configuration without mutating either shop', async ({
  page,
}) => {
  const sourceShopId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
  const { commands } = await mockSettings(
    page,
    ['settings.manage'],
    'OWNER',
    [],
    [shopId, sourceShopId],
  );
  const previews: Record<string, unknown>[] = [];
  await page.route('**/api/admin/shop-copy-preview', async (route) => {
    const request = route.request();
    expect(request.method()).toBe('POST');
    expect(request.headers()['x-tux-admin-csrf']).toBe(csrfToken);
    previews.push(request.postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        sourceSettingsVersion: 3,
        targetSettingsVersion: 7,
        changes: [
          {
            settingKey: 'checkout.taxBps',
            sourceValue: 1500,
            source: 'shop',
            targetValue: 1400,
            targetSource: 'business',
            targetExpectedVersion: null,
            wouldChange: true,
          },
        ],
      }),
    });
  });

  await page.goto('/settings/shop');
  await expect(
    page.getByRole('heading', { name: 'Selective settings copy preview' }),
  ).toBeVisible();
  await page.getByLabel('Source shop').selectOption(sourceShopId);
  await page.getByRole('checkbox', { name: 'Receipt configuration' }).check();
  await page.getByRole('button', { name: 'Preview selected configuration' }).click();
  await expect.poll(() => previews.length).toBe(1);
  expect(previews[0]).toEqual({
    sourceShopId,
    targetShopId: shopId,
    selectedDomains: ['checkout', 'receipts'],
    expectedTargetSettingsVersion: 7,
  });
  await expect(page.getByRole('status')).toContainText('Nothing has been copied');
  expect(commands).toHaveLength(0);
});

test('does not offer cross-shop copy when no other authorized source shop exists', async ({
  page,
}) => {
  await mockSettings(page, ['settings.manage']);
  await page.goto('/settings/shop');
  await expect(page.getByRole('heading', { name: 'Selective settings copy preview' })).toHaveCount(
    0,
  );
});
