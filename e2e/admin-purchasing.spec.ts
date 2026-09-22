import { expect, test, type Page, type Route } from '@playwright/test';
import type { AdminSupplier } from '@tux/admin-contracts';

const shopId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const supplierId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const inactiveSupplierId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc';
const itemId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const poId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const lineId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const csrfToken = 'p'.repeat(64);

const session = {
  principal: {
    employeeId: '11111111-1111-4111-8111-111111111111',
    businessId: '22222222-2222-4222-8222-222222222222',
    role: 'OWNER',
    permissions: ['purchasing.view', 'purchasing.manage', 'purchasing.receive', 'inventory.view'],
    shopIds: [shopId],
  },
  csrfToken,
};

type Command = Record<string, unknown>;

async function mockPurchasing(
  page: Page,
  options: {
    startWithoutSuppliers?: boolean;
    initialSuppliers?: readonly AdminSupplier[];
    failCommandType?: string;
    failureCode?: string;
    failureCodesByCommand?: Readonly<Record<string, string>>;
    supplierCreateResponseLossOnce?: boolean;
  } = {},
) {
  const commands: Command[] = [];
  let suppliers: AdminSupplier[] = options.startWithoutSuppliers
    ? []
    : options.initialSuppliers
      ? [...options.initialSuppliers]
      : [
          {
            id: supplierId,
            businessId: session.principal.businessId,
            name: 'Prime Foods',
            contactName: 'Sara',
            phone: '01000000000',
            email: 'orders@prime.test',
            active: true,
          },
        ];
  let status: 'DRAFT' | 'ORDERED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' = 'DRAFT';
  let version = 1;
  const baseMicrosPerPurchaseUnit = 2_000_000;
  let receivedPurchaseUnitsMicros = 0;
  let returnedPurchaseUnitsMicros = 0;
  let supplierCreateResponseLosses = 0;

  await page.route('**/api/admin/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(session),
    });
  });

  await page.route('**/api/admin/purchasing**', async (route: Route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          shopId,
          suppliers,
          inventoryItems: [{ id: itemId, name: 'Beef', unitLabel: 'kg' }],
          purchaseOrders: [
            {
              id: poId,
              shopId,
              supplierId,
              supplierName: 'Prime Foods',
              status,
              reference: 'PO-100',
              expectedDeliveryDate: '2026-09-20',
              version,
              orderedAt: status === 'DRAFT' ? null : '2026-09-19T06:00:00.000Z',
              createdAt: '2026-09-19T05:00:00.000Z',
              updatedAt: '2026-09-19T06:00:00.000Z',
              lines: [
                {
                  id: lineId,
                  inventoryItemId: itemId,
                  itemName: 'Beef',
                  unitLabel: 'kg',
                  purchaseUnitLabel: 'case',
                  baseMicrosPerPurchaseUnit,
                  orderedPurchaseUnitsMicros: 5_000_000,
                  receivedPurchaseUnitsMicros,
                  returnedPurchaseUnitsMicros,
                  orderedBaseMicros: 10_000_000,
                  receivedBaseMicros:
                    (receivedPurchaseUnitsMicros * baseMicrosPerPurchaseUnit) / 1_000_000,
                  returnedBaseMicros:
                    (returnedPurchaseUnitsMicros * baseMicrosPerPurchaseUnit) / 1_000_000,
                  remainingBaseMicros:
                    10_000_000 -
                    (receivedPurchaseUnitsMicros * baseMicrosPerPurchaseUnit) / 1_000_000,
                  expectedPurchaseUnitCostMinor: 24000,
                  expectedUnitCostMinor: 12000,
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
    const command = request.postDataJSON() as Command;
    commands.push(command);

    const commandType = String(command.type);
    const commandFailure =
      options.failureCodesByCommand?.[commandType] ??
      (commandType === options.failCommandType
        ? (options.failureCode ?? 'purchasing_conflict')
        : null);
    if (commandFailure) {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: commandFailure }),
      });
      return;
    }

    if (command.type === 'supplier.create') {
      suppliers = [
        {
          id: supplierId,
          businessId: session.principal.businessId,
          name: String(command.name),
          contactName: null,
          phone: null,
          email: null,
          active: true,
        },
      ];
      if (options.supplierCreateResponseLossOnce && supplierCreateResponseLosses === 0) {
        supplierCreateResponseLosses += 1;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'temporary_supplier_response_loss' }),
        });
        return;
      }
    }
    if (command.type === 'po.order') {
      status = 'ORDERED';
      version += 1;
    }
    if (command.type === 'po.receive') {
      receivedPurchaseUnitsMicros += Number(
        (command.lines as Array<{ receivedPurchaseUnitsMicros: number }>)[0]
          ?.receivedPurchaseUnitsMicros ?? 0,
      );
      status = receivedPurchaseUnitsMicros < 5_000_000 ? 'PARTIALLY_RECEIVED' : 'RECEIVED';
      version += 1;
    }
    if (command.type === 'po.return') {
      returnedPurchaseUnitsMicros += Number(
        (command.lines as Array<{ returnedPurchaseUnitsMicros: number }>)[0]
          ?.returnedPurchaseUnitsMicros ?? 0,
      );
      version += 1;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, purchaseOrderId: poId, status, version }),
    });
  });

  return { commands };
}

test('purchasing renders suppliers and can order a draft PO through the trusted BFF', async ({
  page,
}) => {
  const fixture = await mockPurchasing(page);
  await page.goto('/purchasing');

  await expect(page.getByRole('heading', { name: 'Purchasing' })).toBeVisible();
  await expect(page.getByText('Prime Foods').first()).toBeVisible();
  await expect(page.getByText('PO-100').first()).toBeVisible();

  await page.getByRole('button', { name: 'Mark ordered' }).click();

  await expect.poll(() => fixture.commands.length).toBe(1);
  expect(fixture.commands[0]).toMatchObject({
    type: 'po.order',
    shopId,
    purchaseOrderId: poId,
    expectedVersion: 1,
  });
});

test('purchasing surfaces ordinary mutation conflicts to the operator', async ({ page }) => {
  await mockPurchasing(page, {
    failCommandType: 'po.order',
    failureCode: 'stale_purchase_order_version',
  });
  await page.goto('/purchasing');

  await page.getByRole('button', { name: 'Mark ordered' }).click();

  await expect(page.getByRole('alert')).toContainText(/stale purchase order version/i);
});

test('purchasing replaces an older mutation error with the most recent failure', async ({
  page,
}) => {
  await mockPurchasing(page, {
    failureCodesByCommand: {
      'supplier.create': 'supplier_name_conflict',
      'po.order': 'stale_purchase_order_version',
    },
  });
  await page.goto('/purchasing');

  await page.getByLabel('Supplier name').fill('Duplicate supplier');
  await page.getByRole('button', { name: 'Add supplier' }).click();
  await expect(page.getByRole('alert')).toContainText(/supplier name conflict/i);

  await page.getByRole('button', { name: 'Mark ordered' }).click();
  await expect(page.getByRole('alert')).toContainText(/stale purchase order version/i);
});

test('purchasing clears an older mutation error after a later action succeeds', async ({ page }) => {
  await mockPurchasing(page, {
    failCommandType: 'supplier.create',
    failureCode: 'supplier_name_conflict',
  });
  await page.goto('/purchasing');

  await page.getByLabel('Supplier name').fill('Duplicate supplier');
  await page.getByRole('button', { name: 'Add supplier' }).click();
  await expect(page.getByRole('alert')).toContainText(/supplier name conflict/i);

  await page.getByRole('button', { name: 'Mark ordered' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('supplier creation retains its command id across a lost response retry', async ({ page }) => {
  const fixture = await mockPurchasing(page, {
    startWithoutSuppliers: true,
    supplierCreateResponseLossOnce: true,
  });
  await page.goto('/purchasing');

  await page.getByLabel('Supplier name').fill('Prime Foods');
  await page.getByRole('button', { name: 'Add supplier' }).click();
  await expect(page.getByRole('alert')).toContainText(/temporary supplier response loss/i);

  await page.getByRole('button', { name: 'Add supplier' }).click();
  await expect.poll(() => fixture.commands.length).toBe(2);

  const firstCommandId = fixture.commands[0]?.commandId;
  const secondCommandId = fixture.commands[1]?.commandId;
  expect(typeof firstCommandId).toBe('string');
  expect(firstCommandId).not.toBe('');
  expect(secondCommandId).toBe(firstCommandId);
});

test('purchase order creation excludes inactive suppliers from options and defaults', async ({
  page,
}) => {
  const fixture = await mockPurchasing(page, {
    initialSuppliers: [
      {
        id: inactiveSupplierId,
        businessId: session.principal.businessId,
        name: 'Archived Foods',
        contactName: null,
        phone: null,
        email: null,
        active: false,
      },
      {
        id: supplierId,
        businessId: session.principal.businessId,
        name: 'Prime Foods',
        contactName: null,
        phone: null,
        email: null,
        active: true,
      },
    ],
  });
  await page.goto('/purchasing');

  await expect(page.getByText('Archived Foods').first()).toBeVisible();
  const purchaseOrders = page.getByRole('region', { name: 'Purchase orders' });
  const supplierSelect = purchaseOrders.getByRole('combobox').first();
  await expect(supplierSelect.getByRole('option', { name: 'Archived Foods' })).toHaveCount(0);
  await expect(supplierSelect).toHaveValue(supplierId);

  await page.getByLabel('Order quantity (purchase units)').fill('1');
  await page.getByRole('button', { name: 'Create purchase order' }).click();

  await expect.poll(() => fixture.commands.length).toBe(1);
  expect(fixture.commands[0]).toMatchObject({
    type: 'po.create',
    supplierId,
  });
});

test('purchase order defaults adopt the first supplier created after an initially empty workspace', async ({
  page,
}) => {
  const fixture = await mockPurchasing(page, { startWithoutSuppliers: true });
  await page.goto('/purchasing');

  await page.getByLabel('Supplier name').fill('Prime Foods');
  await page.getByRole('button', { name: 'Add supplier' }).click();
  await expect(page.getByText('Prime Foods').first()).toBeVisible();

  await page.getByLabel('Order quantity (purchase units)').fill('1');
  await page.getByRole('button', { name: 'Create purchase order' }).click();

  await expect.poll(() => fixture.commands.length).toBe(2);
  expect(fixture.commands[0]).toMatchObject({
    type: 'supplier.create',
    shopId,
    name: 'Prime Foods',
  });
  expect(fixture.commands[1]).toMatchObject({
    type: 'po.create',
    shopId,
    supplierId,
    lines: [
      expect.objectContaining({
        inventoryItemId: itemId,
        orderedPurchaseUnitsMicros: 1_000_000,
      }),
    ],
  });
});

test('purchasing posts partial receiving and purchase returns without pretending the remainder arrived', async ({
  page,
}) => {
  const fixture = await mockPurchasing(page);
  await page.goto('/purchasing');

  await page.getByRole('button', { name: 'Mark ordered' }).click();
  await expect(page.getByText('ORDERED').first()).toBeVisible();

  await page.getByRole('button', { name: 'Receive purchase' }).click();
  await page.getByLabel('Receive Beef').fill('2');
  await page.getByLabel('Unit cost for Beef').fill('250');
  await page.getByLabel('Supplier reference').fill('INV-100');
  await page.getByRole('button', { name: 'Post receipt' }).click();

  await expect(page.getByText('PARTIALLY RECEIVED').first()).toBeVisible();
  await expect(page.getByText(/6 kg remaining/)).toBeVisible();

  await page.getByRole('button', { name: 'Return purchase' }).click();
  await page.getByLabel('Return Beef').fill('0.5');
  await page.getByLabel('Return reference').fill('CN-100');
  await page.getByRole('button', { name: 'Post return' }).click();

  expect(fixture.commands).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'po.receive',
        purchaseOrderId: poId,
        lines: [
          {
            lineId,
            receivedPurchaseUnitsMicros: 2_000_000,
            purchaseUnitCostMinor: 25000,
          },
        ],
      }),
      expect.objectContaining({
        type: 'po.return',
        purchaseOrderId: poId,
        lines: [{ lineId, returnedPurchaseUnitsMicros: 500_000 }],
      }),
    ]),
  );
});
