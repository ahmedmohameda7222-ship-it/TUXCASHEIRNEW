import { expect, test, type Page, type Route } from '@playwright/test';

const shopId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherShopId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const itemId = '11111111-1111-4111-8111-111111111111';
const adjustmentReasonId = '22222222-2222-4222-8222-222222222222';
const wasteReasonId = '33333333-3333-4333-8333-333333333333';
const csrfToken = 'i'.repeat(64);

const ownerSession = {
  principal: {
    employeeId: '44444444-4444-4444-8444-444444444444',
    businessId: '55555555-5555-4555-8555-555555555555',
    role: 'OWNER',
    permissions: [
      'inventory.view',
      'inventory.adjust',
      'inventory.stocktake',
      'inventory.transfer',
      'inventory.override_negative',
    ],
    shopIds: [shopId, otherShopId],
  },
  csrfToken,
};

type InventoryCommand = Record<string, unknown>;

async function mockInventory(page: Page) {
  const commands: InventoryCommand[] = [];
  let onHandMicros = 3_200_000;
  let reservedMicros = 1_100_000;

  await page.route('**/api/admin/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(ownerSession),
    });
  });

  await page.route('**/api/admin/inventory**', async (route: Route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      const url = new URL(request.url());
      expect(url.searchParams.get('shopId')).toBe(shopId);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          shopId,
          items: [
            {
              id: itemId,
              name: 'Beef',
              unitLabel: 'kg',
              trackingMode: 'RECIPE_TRACKED',
              active: true,
              onHandMicros,
              reservedMicros,
              availableMicros: onHandMicros - reservedMicros,
              weightedUnitCostMinor: 12000,
              history: [
                {
                  id: '66666666-6666-4666-8666-666666666666',
                  movementType: 'BULK_STOCK_RECEIVED',
                  quantityDeltaMicros: 3_200_000,
                  reservedDeltaMicros: 0,
                  reasonLabel: null,
                  createdAt: '2026-09-19T02:00:00.000Z',
                },
              ],
            },
          ],
          reasonCodes: [
            {
              id: adjustmentReasonId,
              key: 'COUNT_CORRECTION',
              family: 'STOCK_ADJUSTMENT',
              label: 'Count correction',
            },
            {
              id: wasteReasonId,
              key: 'SPOILAGE',
              family: 'WASTE',
              label: 'Spoilage',
            },
          ],
          transfers: [
            {
              id: '77777777-7777-4777-8777-777777777777',
              sourceShopId: otherShopId,
              destinationShopId: shopId,
              status: 'SENT',
              sentAt: '2026-09-19T03:00:00.000Z',
              receivedAt: null,
              lines: [
                {
                  inventoryItemId: itemId,
                  itemName: 'Beef',
                  unitLabel: 'kg',
                  quantityMicros: 400_000,
                },
              ],
            },
          ],
        }),
      });
      return;
    }

    expect(request.method()).toBe('POST');
    expect(request.headers()['x-tux-admin-csrf']).toBe(csrfToken);
    const command = request.postDataJSON() as InventoryCommand;
    commands.push(command);

    if (command.type === 'adjust') {
      onHandMicros += Number(command.quantityDeltaMicros);
    }
    if (command.type === 'waste') {
      onHandMicros -= Number(command.quantityMicros);
    }
    if (command.type === 'stocktake') {
      const lines = command.lines as Array<{ actualCountMicros: number }>;
      onHandMicros = lines[0]?.actualCountMicros ?? onHandMicros;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, idempotentReplay: false }),
    });
  });

  return { commands };
}

test('inventory renders on-hand, reserved, available, history, and action entry points', async ({
  page,
}) => {
  await mockInventory(page);
  await page.goto('/inventory');

  await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();
  await page.getByRole('button', { name: /Beef/ }).click();

  await expect(page.getByText('On Hand', { exact: true })).toBeVisible();
  await expect(page.getByText('3.2 kg')).toBeVisible();
  await expect(page.getByText('Reserved', { exact: true })).toBeVisible();
  await expect(page.getByText('1.1 kg')).toBeVisible();
  await expect(page.getByText('Available', { exact: true })).toBeVisible();
  await expect(page.getByText('2.1 kg')).toBeVisible();
  await expect(page.getByText('BULK STOCK RECEIVED')).toBeVisible();

  await expect(page.getByRole('button', { name: 'Adjust stock' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record waste' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stock count' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Transfer stock' })).toBeVisible();
});

test('inventory adjustment and waste use structured reasons through the trusted BFF', async ({
  page,
}) => {
  const fixture = await mockInventory(page);
  await page.goto('/inventory');
  await page.getByRole('button', { name: /Beef/ }).click();

  await page.getByRole('button', { name: 'Adjust stock' }).click();
  await page.getByLabel('Quantity change').fill('0.5');
  await page.getByLabel('Adjustment reason').selectOption(adjustmentReasonId);
  await page.getByRole('button', { name: 'Post adjustment' }).click();

  await page.getByRole('button', { name: 'Record waste' }).click();
  await page.getByLabel('Waste quantity').fill('0.25');
  await page.getByLabel('Waste reason').selectOption(wasteReasonId);
  await page.getByRole('button', { name: 'Post waste' }).click();

  await expect.poll(() => fixture.commands.length).toBe(2);
  expect(fixture.commands[0]).toMatchObject({
    type: 'adjust',
    shopId,
    inventoryItemId: itemId,
    quantityDeltaMicros: 500_000,
    reasonCodeId: adjustmentReasonId,
    emergencyNegativeOverride: false,
  });
  expect(fixture.commands[1]).toMatchObject({
    type: 'waste',
    shopId,
    inventoryItemId: itemId,
    quantityMicros: 250_000,
    reasonCodeId: wasteReasonId,
    emergencyNegativeOverride: false,
  });
});

test('inventory stocktake exposes variance/recount/approval state and posts immutable count input', async ({
  page,
}) => {
  const fixture = await mockInventory(page);
  await page.goto('/inventory');
  await page.getByRole('button', { name: 'Stock count' }).click();

  await expect(page.getByText('Snapshot on hand')).toBeVisible();
  await expect(page.getByText('Recount state')).toBeVisible();
  await expect(page.getByText('Approval required')).toBeVisible();

  await page.getByLabel('Actual count for Beef').fill('3.0');
  await expect(page.getByText('-0.2 kg')).toBeVisible();
  await page.getByRole('button', { name: 'Post stock count' }).click();

  await expect.poll(() => fixture.commands.length).toBe(1);
  expect(fixture.commands[0]).toMatchObject({
    type: 'stocktake',
    shopId,
    lines: [{ inventoryItemId: itemId, actualCountMicros: 3_000_000 }],
  });
});

test('inventory can receive a sent inter-shop transfer without using purchasing receive', async ({
  page,
}) => {
  const fixture = await mockInventory(page);
  await page.goto('/inventory');
  await page.getByRole('button', { name: 'Transfer stock' }).click();

  await expect(page.getByText('Incoming sent transfers')).toBeVisible();
  await expect(page.getByText('0.4 kg Beef')).toBeVisible();
  await page.getByRole('button', { name: 'Receive transfer' }).click();

  await expect.poll(() => fixture.commands.length).toBe(1);
  expect(fixture.commands[0]).toMatchObject({
    type: 'transfer.receive',
    transferId: '77777777-7777-4777-8777-777777777777',
  });
});
