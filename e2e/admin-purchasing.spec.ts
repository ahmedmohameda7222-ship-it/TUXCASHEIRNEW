import {
  capturePremiumScreenshot,
  premiumVisualViewports,
  captureTargetedAcceptance,
  verifyTargetedVisualLayout,
} from './premiumVisualEvidence';
import { expect, test, type Page, type Route } from '@playwright/test';
import type { AdminSupplier } from '@tux/admin-contracts';
import { ADMIN_CORE_VIEWPORTS } from './adminViewports';

const shopId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const supplierId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const inactiveSupplierId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc';
const itemId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const secondItemId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccd';
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
    shopSummaries: [{ id: shopId, name: 'TUX Maadi', active: true, temporaryClosed: false }],
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
            version: 1,
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
      const requestedOrder = new URL(request.url()).searchParams.get('purchaseOrderId');
      if (requestedOrder) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            shopId,
            purchaseOrderId: requestedOrder,
            truncated: false,
            events: [],
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          shopId,
          suppliers,
          inventoryItems: [
            {
              id: itemId,
              name: 'Beef',
              unitLabel: 'kg',
              purchaseUnits: [{ label: 'case', baseMicrosPerPurchaseUnit }],
            },
            {
              id: secondItemId,
              name: 'Chicken',
              unitLabel: 'kg',
              purchaseUnits: [{ label: 'case', baseMicrosPerPurchaseUnit }],
            },
          ],
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

async function openPurchaseOrders(page: Page) {
  await page.getByRole('tab', { name: 'Purchase orders' }).click();
  await expect(page.getByRole('heading', { name: 'Purchase orders' })).toBeVisible();
}

async function selectPurchaseOrder(page: Page, reference = 'PO-100') {
  await openPurchaseOrders(page);
  await page.getByRole('button', { name: new RegExp(reference) }).click();
  await expect(page.getByRole('region', { name: 'Purchase order detail' })).toBeVisible();
}

async function openSuppliers(page: Page) {
  await page.getByRole('tab', { name: 'Suppliers' }).click();
  await expect(page.getByRole('heading', { name: 'Suppliers' })).toBeVisible();
}

async function openSupplierDialog(page: Page) {
  await openSuppliers(page);
  await page.getByRole('button', { name: 'Add supplier' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

// Approved design evidence: rendered Admin app, not the standalone HTML prototype.
// Network responses below are UI fixtures; transactional integration is exercised
// separately against disposable PostgreSQL.
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1100, height: 850 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 360, height: 760 },
]) {
  test(`approved Purchasing list/detail/supplier layouts at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await mockPurchasing(page);
    await page.goto('/purchasing');

    const search = page.getByRole('searchbox', { name: 'Search purchase orders' });
    await expect(search).toBeVisible();
    await search.fill('not-in-workspace');
    await expect(page.getByText('No purchase orders match these filters.')).toBeVisible();
    await page.getByRole('button', { name: 'Reset filters' }).click();
    await expect(page.getByRole('button', { name: /PO-100/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `test-results/purchasing-approved-orders-${viewport.width}.png`,
      fullPage: true,
    });

    await selectPurchaseOrder(page);
    await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Items', exact: true }).click();
    await expect(
      page.locator('.admin-purchasing-line-item strong', { hasText: 'Beef' }),
    ).toBeVisible();
    await page.getByRole('tab', { name: 'History', exact: true }).click();
    await expect(page.getByText(/No receipt or return event history is available/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `test-results/purchasing-approved-detail-${viewport.width}.png`,
      fullPage: true,
    });

    if (viewport.width <= 480) {
      await page.getByRole('link', { name: /back to purchasing/i }).click();
    }
    await openSuppliers(page);
    await expect(page.getByRole('combobox', { name: 'Filter suppliers by status' })).toBeVisible();
    await page
      .getByRole('combobox', { name: 'Filter suppliers by status' })
      .selectOption('archived');
    await expect(page.getByText('No suppliers match these filters.')).toBeVisible();
    await page.getByRole('button', { name: 'Reset filters' }).click();
    await page.getByRole('button', { name: 'Prime Foods', exact: true }).click();
    await expect(
      page.getByRole('complementary', { name: 'Selected supplier detail' }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `test-results/purchasing-approved-suppliers-${viewport.width}.png`,
      fullPage: true,
    });
  });
}

test('purchasing renders suppliers and can order a draft PO through the trusted BFF', async ({
  page,
}) => {
  const fixture = await mockPurchasing(page);
  await page.goto('/purchasing');

  await expect(page.getByRole('heading', { name: 'Purchasing' })).toBeVisible();
  await expect(
    page.locator('.admin-purchasing-row-supplier', { hasText: 'Prime Foods' }),
  ).toBeVisible();
  await expect(page.getByText('PO-100').first()).toBeVisible();

  await selectPurchaseOrder(page);
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

  await selectPurchaseOrder(page);
  await page.getByRole('button', { name: 'Mark ordered' }).click();

  await expect(page.getByRole('alert')).toContainText(/purchase order changed/i);
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

  const dialog = await openSupplierDialog(page);
  await dialog.getByLabel('Supplier name').fill('Duplicate supplier');
  await dialog.getByRole('button', { name: 'Add supplier' }).click();
  await expect(page.getByRole('alert')).toContainText(
    /supplier with these details already exists/i,
  );

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await selectPurchaseOrder(page);
  await page.getByRole('button', { name: 'Mark ordered' }).click();
  await expect(page.getByRole('alert')).toContainText(/purchase order changed/i);
});

test('purchasing clears an older mutation error after a later action succeeds', async ({
  page,
}) => {
  await mockPurchasing(page, {
    failCommandType: 'supplier.create',
    failureCode: 'supplier_name_conflict',
  });
  await page.goto('/purchasing');

  const dialog = await openSupplierDialog(page);
  await dialog.getByLabel('Supplier name').fill('Duplicate supplier');
  await dialog.getByRole('button', { name: 'Add supplier' }).click();
  await expect(page.getByRole('alert')).toContainText(
    /supplier with these details already exists/i,
  );

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await selectPurchaseOrder(page);
  await page.getByRole('button', { name: 'Mark ordered' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('supplier creation retains its command id across a lost response retry', async ({ page }) => {
  const fixture = await mockPurchasing(page, {
    startWithoutSuppliers: true,
    supplierCreateResponseLossOnce: true,
  });
  await page.goto('/purchasing');

  const dialog = await openSupplierDialog(page);
  await dialog.getByLabel('Supplier name').fill('Prime Foods');
  await dialog.getByRole('button', { name: 'Add supplier' }).click();
  await expect(page.getByRole('alert')).toContainText(/purchasing action could not be completed/i);

  await dialog.getByRole('button', { name: 'Add supplier' }).click();
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

  await openSuppliers(page);
  await expect(page.getByText('Archived Foods').first()).toBeVisible();
  await openPurchaseOrders(page);
  await page.getByRole('button', { name: 'New purchase order' }).click();
  const purchaseOrders = page.getByRole('region', { name: 'Purchase orders' });
  const supplierSelect = page
    .getByRole('dialog', { name: 'New purchase order' })
    .getByRole('combobox', { name: 'Supplier' });
  await expect(supplierSelect.getByRole('option', { name: 'Archived Foods' })).toHaveCount(0);
  await expect(supplierSelect).toHaveValue(supplierId);

  await page.getByLabel('Quantity (purchase units)').fill('1');
  await page.getByLabel('Expected cost per purchase unit (EGP)').fill('240');
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

  const dialog = await openSupplierDialog(page);
  await dialog.getByLabel('Supplier name').fill('Prime Foods');
  await dialog.getByRole('button', { name: 'Add supplier' }).click();
  await expect(page.getByRole('button', { name: 'Prime Foods', exact: true })).toBeVisible();

  await openPurchaseOrders(page);
  await page.getByRole('button', { name: 'New purchase order' }).click();
  await page.getByLabel('Quantity (purchase units)').fill('1');
  await page.getByLabel('Expected cost per purchase unit (EGP)').fill('240');
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

  await selectPurchaseOrder(page);
  await page.getByRole('button', { name: 'Mark ordered' }).click();
  await expect(page.locator('.admin-purchasing-order-header').getByText('Ordered')).toBeVisible();

  await page.getByRole('button', { name: 'Receive purchase' }).click();
  await page.getByLabel('Receive Beef').fill('2');
  await page.getByLabel('Unit cost for Beef').fill('250');
  await page.getByLabel('Supplier reference').fill('INV-100');
  await page.getByRole('button', { name: 'Post receipt' }).click();

  await expect(
    page.locator('.admin-purchasing-order-header').getByText('Partially received'),
  ).toBeVisible();
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

for (const viewport of premiumVisualViewports(ADMIN_CORE_VIEWPORTS)) {
  test(`purchasing master-detail remains usable at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockPurchasing(page);
    await page.goto('/purchasing');

    const list = page.locator('.admin-master-detail__list');
    await list.getByRole('button', { name: /PO-100/ }).click();
    await expect(page.locator('.admin-master-detail__detail')).toBeVisible();
    const header = page.locator('.admin-purchasing-order-header');
    await expect(header).toBeVisible();
    expect(await header.evaluate((node) => getComputedStyle(node).display)).toBe('flex');
    expect(
      await header
        .locator('.admin-purchasing-order-header__identity')
        .evaluate((node) => getComputedStyle(node).flexDirection),
    ).toBe('column');
    const actions = page.locator('.admin-purchasing-page-actions').first();
    await expect(actions).toBeVisible();
    expect(await actions.evaluate((node) => getComputedStyle(node).display)).toBe('flex');

    if (viewport.width <= 480) {
      await expect(list).toBeHidden();
      await expect(page.getByRole('link', { name: /back to purchasing/i })).toBeVisible();
    } else {
      await expect(list).toBeVisible();
    }

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await capturePremiumScreenshot(page, 'purchasing');
  });
}

test('selected supplier details appear adjacent to compact directory on desktop', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockPurchasing(page);
  await page.goto('/purchasing');
  await openSuppliers(page);
  const directory = page.locator('.admin-supplier-directory');
  const inspector = page.getByRole('complementary', { name: 'Selected supplier detail' });
  await expect(inspector).toBeVisible();
  await expect(inspector.getByRole('heading', { name: 'Prime Foods' })).toBeVisible();
  const listBounds = await directory.boundingBox();
  const detailBounds = await inspector.boundingBox();
  expect(listBounds).not.toBeNull();
  expect(detailBounds).not.toBeNull();
  expect(detailBounds!.x).toBeGreaterThan(listBounds!.x + listBounds!.width - 3);
  expect(Math.abs(detailBounds!.y - listBounds!.y)).toBeLessThan(40);
});

test('supplier form exposes linked field guidance and restores focus after Escape', async ({
  page,
}) => {
  await mockPurchasing(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/purchasing');
  const dialog = await openSupplierDialog(page);
  const phone = dialog.getByRole('textbox', { name: 'Phone' });
  await expect(phone).toHaveAttribute('aria-describedby', 'supplier-phone-hint');
  await expect(dialog.locator('#supplier-phone-hint')).toContainText('Optional contact number');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Add supplier' })).toBeFocused();
});

for (const viewport of [
  { name: 'small-phone', width: 320, height: 720 },
  { name: 'narrow-phone', width: 375, height: 844 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop-1280', width: 1280, height: 800 },
  { name: 'desktop', width: 1440, height: 900 },
]) {
  test(`captures supplier and wide PO task surfaces at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await mockPurchasing(page);
    await page.goto('/purchasing');
    const supplier = await openSupplierDialog(page);
    await expect(supplier.getByLabel('Supplier name')).toBeVisible();
    const supplierBounds = await supplier.boundingBox();
    expect(supplierBounds).not.toBeNull();
    expect(
      Math.abs(supplierBounds!.x + supplierBounds!.width / 2 - viewport.width / 2),
    ).toBeLessThan(4);
    expect(supplierBounds!.y).toBeGreaterThanOrEqual(8);
    expect(supplierBounds!.y + supplierBounds!.height).toBeLessThanOrEqual(viewport.height - 8);
    if (supplierBounds!.height < viewport.height * 0.8) {
      expect(
        Math.abs(supplierBounds!.y + supplierBounds!.height / 2 - viewport.height / 2),
      ).toBeLessThan(8);
    }
    await page.screenshot({
      path: `test-results/admin-stage1-supplier-${viewport.name}.png`,
      fullPage: true,
    });
    await capturePremiumScreenshot(page, 'supplier-dialog');
    await page.keyboard.press('Escape');
    await expect(supplier).toBeHidden();
    await openPurchaseOrders(page);
    await page.getByRole('button', { name: 'New purchase order' }).click();
    const po = page.getByRole('dialog', { name: 'New purchase order' });
    await expect(po.getByLabel('Quantity (purchase units)')).toBeVisible();
    const bounds = await po.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(Math.abs(bounds!.x + bounds!.width / 2 - viewport.width / 2)).toBeLessThan(4);
    expect(bounds!.y).toBeGreaterThanOrEqual(8);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height - 8);
    if (viewport.width >= 768) expect(bounds!.width).toBeGreaterThan(700);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    ).toBe(false);
    await page.screenshot({
      path: `test-results/admin-stage1-purchase-order-${viewport.name}.png`,
      fullPage: true,
    });
    await capturePremiumScreenshot(page, 'po-dialog');
  });
}

for (const width of [320, 390]) {
  test(`mobile PO task exposes every action after scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 720 : 844 });
    const fixture = await mockPurchasing(page);
    await page.goto('/purchasing');
    await openPurchaseOrders(page);
    await page.getByRole('button', { name: 'New purchase order' }).click();

    const dialog = page.getByRole('dialog', { name: 'New purchase order' });
    const body = dialog.locator('.admin-dialog__body');
    await expect(dialog.getByLabel('Expected delivery')).toBeVisible();
    await dialog.getByRole('button', { name: 'Add line' }).click();
    await expect(dialog.locator('fieldset')).toHaveCount(2);
    await dialog.locator('fieldset').nth(1).getByLabel('Inventory item').selectOption(secondItemId);
    for (const fieldset of await dialog.locator('fieldset').all()) {
      await fieldset.getByLabel('Quantity (purchase units)').fill('2');
      await fieldset.getByLabel('Expected cost per purchase unit (EGP)').fill('240');
    }
    await body.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    const submit = dialog.getByRole('button', { name: 'Create purchase order' });
    await expect(submit).toBeInViewport();
    await expect(submit).toBeEnabled();
    await page.screenshot({
      path: `test-results/admin-stage1-po-final-actions-${width}.png`,
    });
    await submit.focus();
    await expect(submit).toBeFocused();
    await submit.press('Enter');
    await expect.poll(() => fixture.commands.length).toBe(1);
    expect(fixture.commands[0]).toMatchObject({
      type: 'po.create',
      lines: [
        expect.objectContaining({ inventoryItemId: itemId, orderedPurchaseUnitsMicros: 2_000_000 }),
        expect.objectContaining({
          inventoryItemId: secondItemId,
          orderedPurchaseUnitsMicros: 2_000_000,
        }),
      ],
    });
  });
}

for (const width of [320, 390]) {
  test(`mobile PO validation and cancellation remain accessible at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 320 ? 720 : 844 });
    const fixture = await mockPurchasing(page);
    await page.goto('/purchasing');
    await openPurchaseOrders(page);
    const trigger = page.getByRole('button', { name: 'New purchase order' });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'New purchase order' });
    await dialog.getByLabel('Quantity (purchase units)').fill('0');
    await dialog.getByLabel('Expected cost per purchase unit (EGP)').fill('240');
    await dialog.getByRole('button', { name: 'Create purchase order' }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    expect(fixture.commands).toHaveLength(0);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await dialog.getByLabel('Quantity (purchase units)').fill('2');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(fixture.commands).toHaveLength(0);
  });
}

test('shared Supplier and PO surfaces use dark theme tokens', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 390, height: 844 });
  await mockPurchasing(page);
  await page.goto('/purchasing');
  const supplier = await openSupplierDialog(page);
  await page.screenshot({ path: 'test-results/admin-stage1-supplier-dark-phone.png' });
  await page.keyboard.press('Escape');
  await expect(supplier).toBeHidden();
  await openPurchaseOrders(page);
  await page.getByRole('button', { name: 'New purchase order' }).click();
  await expect(page.getByRole('dialog', { name: 'New purchase order' })).toBeVisible();
  await page.screenshot({ path: 'test-results/admin-stage1-purchase-order-dark-phone.png' });
});

for (const viewport of premiumVisualViewports([{ name: 'desktop', width: 1440, height: 900 }])) {
  test(
    'supplier archive requires named confirmation at ' + viewport.width + 'px',
    async ({ page }) => {
      await page.setViewportSize(viewport);
      const fixture = await mockPurchasing(page);
      await page.goto('/purchasing');
      await openSuppliers(page);
      await page.getByRole('button', { name: 'Archive Prime Foods' }).click();
      const dialog = page.getByRole('dialog', { name: 'Archive supplier?' });
      await expect(dialog).toContainText('Prime Foods');
      await capturePremiumScreenshot(page, 'supplier-archive');
      expect(
        fixture.commands.filter((command) => command.type === 'supplier.archive'),
      ).toHaveLength(0);
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      expect(
        fixture.commands.filter((command) => command.type === 'supplier.archive'),
      ).toHaveLength(0);
      await page.getByRole('button', { name: 'Archive Prime Foods' }).click();
      await dialog.getByRole('button', { name: 'Archive supplier' }).click();
      await expect
        .poll(
          () => fixture.commands.filter((command) => command.type === 'supplier.archive').length,
        )
        .toBe(1);
    },
  );
}

if (process.env['P04_P07_TARGETED_CAPTURE'] === '1') {
  for (const width of [390, 1440] as const) {
    for (const theme of ['light', 'dark'] as const) {
      for (const entry of ['cold', 'warm'] as const) {
        test(`targeted P04 purchasing ${theme} ${entry} ${width}px`, async ({ page }) => {
          await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
          await mockPurchasing(page);
          await verifyTargetedVisualLayout(page, {
            route: '/purchasing',
            heading: 'Purchasing',
            theme,
            entry,
          });
          await captureTargetedAcceptance(page, 'p04', 'purchasing', theme, entry);
        });
      }
    }
  }
}
