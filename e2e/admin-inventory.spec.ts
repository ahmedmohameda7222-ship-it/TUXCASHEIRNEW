import {
  capturePremiumScreenshot,
  premiumVisualViewports,
  PREMIUM_EVIDENCE_VIEWPORTS,
  captureTargetedAcceptance,
  verifyTargetedVisualLayout,
} from './premiumVisualEvidence';
import { expect, test, type Page, type Route } from '@playwright/test';
import { ADMIN_CORE_VIEWPORTS } from './adminViewports';

const shopId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherShopId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const itemId = '11111111-1111-4111-8111-111111111111';
const alphabeticalFirstItemId = '88888888-8888-4888-8888-888888888888';
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
      'purchasing.manage',
    ],
    shopIds: [shopId, otherShopId],
    shopSummaries: [
      { id: shopId, name: 'TUX Maadi', active: true, temporaryClosed: false },
      { id: otherShopId, name: 'TUX QA Shop B', active: true, temporaryClosed: true },
    ],
  },
  csrfToken,
};

type InventoryCommand = Record<string, unknown>;

async function mockInventory(
  page: Page,
  options: {
    failCommandType?: string;
    failureCode?: string;
    failureCodesByCommand?: Readonly<Record<string, string>>;
    itemActive?: boolean;
    includeAlphabeticalFirst?: boolean;
    includePurchaseConversion?: boolean;
    exactThresholdMicros?: number;
    includeSecondTrackedItem?: boolean;
    allowStaleItemHistory?: boolean;
    pendingAdjustment?: boolean;
  } = {},
) {
  const commands: InventoryCommand[] = [];
  let onHandMicros = 3_200_000;
  const reservedMicros = 1_100_000;

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
      const view = url.searchParams.get('view');
      if (view === 'stocktake-eligibility') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ allowed: true, code: 'off_shift_allowed' }),
        });
        return;
      }
      if (view === 'stocktake-sessions') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, sessions: [] }),
        });
        return;
      }
      const requestedInventoryItemId = url.searchParams.get('inventoryItemId');
      if (requestedInventoryItemId !== null) {
        if (options.allowStaleItemHistory && requestedInventoryItemId !== itemId) {
          await route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'inventory_item_not_found' }),
          });
          return;
        }
        if (requestedInventoryItemId !== itemId) {
          expect(options.includeAlphabeticalFirst).toBe(true);
          expect(requestedInventoryItemId).toBe(alphabeticalFirstItemId);
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            inventoryItemId: requestedInventoryItemId,
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
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          shopId,
          shops: [
            { id: shopId, name: 'TUX Maadi' },
            { id: otherShopId, name: 'TUX Zamalek' },
          ],
          items: [
            {
              id: itemId,
              name: 'Beef',
              unitLabel: 'kg',
              trackingMode: 'RECIPE_TRACKED',
              active: options.itemActive ?? true,
              onHandMicros,
              reservedMicros,
              availableMicros: onHandMicros - reservedMicros,
              weightedUnitCostMinor: 12000,
              history: [],
              ...(options.exactThresholdMicros === undefined
                ? {}
                : { lowStockThresholdMicros: options.exactThresholdMicros }),
              ...(options.includePurchaseConversion
                ? {
                    definitionVersion: 7,
                    conversions: [
                      {
                        id: '66666666-6666-4666-8666-666666666667',
                        inventoryItemId: itemId,
                        purchaseUnitLabel: 'case',
                        baseMicrosPerPurchaseUnit: 12_000_000,
                        active: true,
                        definitionVersion: 3,
                      },
                    ],
                  }
                : {}),
            },
            ...(options.includeSecondTrackedItem
              ? [
                  {
                    id: '99999999-9999-4999-8999-999999999998',
                    name: 'Rice',
                    unitLabel: 'g',
                    trackingMode: 'RECIPE_TRACKED',
                    active: true,
                    definitionVersion: 1,
                    onHandMicros: 1_000_000,
                    reservedMicros: 0,
                    availableMicros: 1_000_000,
                    weightedUnitCostMinor: 0,
                    history: [],
                  },
                ]
              : []),
            ...(options.includeAlphabeticalFirst
              ? [
                  {
                    id: alphabeticalFirstItemId,
                    name: 'Apple',
                    unitLabel: 'kg',
                    trackingMode: 'RECIPE_TRACKED',
                    active: true,
                    onHandMicros: 2_000_000,
                    reservedMicros: 0,
                    availableMicros: 2_000_000,
                    weightedUnitCostMinor: 12000,
                    history: [],
                  },
                ]
              : []),
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
          intelligence: {
            periodLabel: 'Last 30 days',
            reorderSuggestions: [
              {
                inventoryItemId: itemId,
                itemName: 'Beef',
                unitLabel: 'kg',
                availableMicros: onHandMicros - reservedMicros,
                incomingMicros: 0,
                parLevelMicros: 3_000_000,
                reorderPointMicros: 2_500_000,
                suggestedOrderMicros: 900_000,
                preferredSupplierId: null,
                preferredPurchaseUnit: 'case',
                leadTimeDays: 2,
                minimumOrderMicros: null,
                orderMultipleMicros: null,
                version: 4,
              },
            ],
            variances: [],
            marginAlerts: [],
          },
        }),
      });
      return;
    }

    expect(request.method()).toBe('POST');
    expect(request.headers()['x-tux-admin-csrf']).toBe(csrfToken);
    const command = request.postDataJSON() as InventoryCommand;
    commands.push(command);

    const commandType = String(command.type);
    const commandFailure =
      options.failureCodesByCommand?.[commandType] ??
      (commandType === options.failCommandType
        ? (options.failureCode ?? 'inventory_conflict')
        : null);
    if (commandFailure) {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: commandFailure }),
      });
      return;
    }

    if (command.type === 'adjust' && options.pendingAdjustment) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, idempotentReplay: false, state: 'PENDING_APPROVAL' }),
      });
      return;
    }
    if (command.type === 'adjust') {
      onHandMicros += Number(command.quantityDeltaMicros);
    }
    if (command.type === 'waste') {
      onHandMicros -= Number(command.quantityMicros);
    }
    if (command.type === 'stocktake.begin') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          idempotentReplay: false,
          stocktakeId: '99999999-9999-4999-8999-999999999999',
          lines: [
            {
              inventoryItemId: itemId,
              snapshotOnHandMicros: onHandMicros,
              snapshotReservedMicros: reservedMicros,
              unitCostMinor: 12000,
            },
          ],
        }),
      });
      return;
    }
    if (command.type === 'stocktake.save') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, idempotentReplay: false, draftRevision: 1 }),
      });
      return;
    }
    if (command.type === 'stocktake.post') {
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

test('I1 desktop inventory defaults to the first authorized item and approved action order', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 940 });
  await mockInventory(page);
  await page.goto('/inventory');
  await expect(page.getByLabel('Inventory item detail')).toBeVisible();
  await expect(page.locator('.admin-inventory-row.is-selected')).toContainText('Beef');

  const actions = await page
    .locator('.admin-inventory-page-actions')
    .evaluate((container) =>
      Array.from(container.children, (child) =>
        child.tagName === 'DETAILS'
          ? child.querySelector('summary')?.textContent?.trim()
          : child.textContent?.trim(),
      ),
    );
  expect(actions).toEqual(['Export CSV', 'Stock count', 'More actions', 'Add inventory item']);
  await page.screenshot({ path: 'test-results/inventory-i1-desktop-1440.png' });
});

test('I1 desktop selects the alphabetically first displayed item, not the API row order', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 940 });
  await mockInventory(page, { includeAlphabeticalFirst: true });
  await page.goto('/inventory');
  await expect(page.locator('.admin-inventory-row').first()).toContainText('Apple');
  await expect(page.locator('.admin-inventory-row.is-selected')).toContainText('Apple');
  await expect(page.getByLabel('Inventory item detail')).toContainText('Apple');
});

test('I1 mobile-first phone shows a complete first item above fixed navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockInventory(page);
  await page.goto('/inventory');

  const first = page
    .getByRole('region', { name: 'Inventory items' })
    .locator('.admin-inventory-row')
    .first();
  await expect(first).toContainText('Beef');
  await expect(first).toContainText('kg');
  await expect(first).toContainText('In stock');
  const rowBox = await first.boundingBox();
  expect(rowBox).not.toBeNull();
  expect(rowBox!.y + rowBox!.height).toBeLessThanOrEqual(844 - 72);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('I1 phone opens the inventory list without forcing an inspector route', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockInventory(page);
  await page.goto('/inventory');
  await expect(page.getByRole('region', { name: 'Inventory items' })).toBeVisible();
  await expect(page.getByLabel('Inventory item detail')).toBeHidden();
  await page.screenshot({ path: 'test-results/inventory-i1-mobile-390.png' });
});

test('I1 mobile item detail replaces the directory header with a visible single-pane inspector', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockInventory(page);
  await page.goto('/inventory');
  await page
    .getByRole('region', { name: 'Inventory items' })
    .getByRole('button', { name: /Beef/ })
    .click();

  const inspector = page.getByLabel('Inventory item detail');
  const itemHeading = inspector.getByRole('heading', { name: 'Beef' });
  await expect(itemHeading).toBeVisible();
  await expect(page.getByRole('link', { name: /back to inventory items/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Inventory', exact: true })).toBeHidden();
  const headingBox = await itemHeading.boundingBox();
  expect(headingBox).not.toBeNull();
  expect(headingBox!.y).toBeLessThan(240);
  await page.screenshot({ path: 'test-results/inventory-i1-item-detail-mobile-390.png' });
});

test('I1 360px inspector keeps all three balance cards on one readable row', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await mockInventory(page);
  await page.goto('/inventory');
  await page
    .getByRole('region', { name: 'Inventory items' })
    .getByRole('button', { name: /Beef/ })
    .click();

  const cards = page.locator('.inventory-balance-grid > div');
  await expect(cards).toHaveCount(3);
  const topEdges = await cards.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().top),
  );
  expect(Math.max(...topEdges) - Math.min(...topEdges)).toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/inventory-i1-item-detail-mobile-360.png' });
});

test('I2 mobile create and edit forms are focused above the directory and restore context', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockInventory(page);
  await page.goto('/inventory');

  await page.getByRole('button', { name: 'Add inventory item' }).click();
  const addEditor = page.getByRole('region', { name: 'Add inventory item' });
  await expect(addEditor.getByLabel('Item name')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Inventory', exact: true })).toBeHidden();
  const addBox = await addEditor.getByLabel('Item name').boundingBox();
  expect(addBox).not.toBeNull();
  expect(addBox!.y).toBeLessThan(290);
  await page.screenshot({ path: 'test-results/inventory-i2-add-mobile-390.png' });
  await addEditor.getByRole('button', { name: 'Close' }).click();

  await expect(page.getByRole('heading', { name: 'Inventory', exact: true })).toBeVisible();
  await page
    .getByRole('region', { name: 'Inventory items' })
    .getByRole('button', { name: /Beef/ })
    .click();
  await page.getByRole('button', { name: 'Edit item' }).click();

  const editEditor = page.getByRole('region', { name: 'Edit inventory item' });
  await expect(editEditor.getByLabel('Item name')).toHaveValue('Beef');
  await expect(page.getByRole('heading', { name: 'Inventory', exact: true })).toBeHidden();
  const editBox = await editEditor.getByLabel('Item name').boundingBox();
  expect(editBox).not.toBeNull();
  expect(editBox!.y).toBeLessThan(290);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/inventory-i2-edit-mobile-390.png' });
  await editEditor.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByLabel('Inventory item detail')).toBeVisible();
});

test('I2 rejects case-insensitive duplicate purchase-unit labels before any command', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { commands } = await mockInventory(page, { includePurchaseConversion: true });
  await page.goto('/inventory');
  await page
    .getByRole('region', { name: 'Inventory items' })
    .getByRole('button', { name: /Beef/ })
    .click();
  await page.getByRole('button', { name: 'Edit item' }).click();

  const editor = page.getByRole('region', { name: 'Edit inventory item' });
  await expect(editor).toContainText('case');
  await editor.getByRole('button', { name: 'Add purchase unit' }).click();
  await editor.getByLabel('Purchase unit label').fill('CASE');
  await editor.getByLabel('Base units per purchase unit').fill('12');
  await editor.getByRole('button', { name: 'Save purchase unit' }).click();

  await expect(editor.getByRole('alert')).toContainText(/already exists/i);
  expect(commands).toHaveLength(0);
});

test('I2 preserves exact six-decimal threshold micros after edit form initialization', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockInventory(page, { exactThresholdMicros: Number.MAX_SAFE_INTEGER });
  await page.goto('/inventory');
  await page
    .getByRole('region', { name: 'Inventory items' })
    .getByRole('button', { name: /Beef/ })
    .click();
  await page.getByRole('button', { name: 'Edit item' }).click();

  await expect(
    page
      .getByRole('region', { name: 'Edit inventory item' })
      .getByLabel('Low-stock threshold (base units)'),
  ).toHaveValue('9007199254.740991');
});

test('I2 create submits accurate zero threshold and tracking selection without stock overwrite', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { commands } = await mockInventory(page);
  await page.goto('/inventory');
  await page.getByRole('button', { name: 'Add inventory item' }).click();
  const editor = page.getByRole('region', { name: 'Add inventory item' });
  await editor.getByLabel('Item name').fill('Minced beef');
  await editor.getByLabel('Base unit', { exact: true }).fill('kg');
  await editor.getByLabel('Tracking mode').selectOption('BULK_MANUAL');
  await editor.getByLabel('Low-stock threshold (base units)').fill('0');
  await editor.getByRole('button', { name: 'Create inventory item' }).click();

  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({
    type: 'item.create',
    entityId: null,
    expectedVersion: null,
    payload: {
      name: 'Minced beef',
      unitLabel: 'kg',
      trackingMode: 'BULK_MANUAL',
      lowStockThresholdMicros: 0,
    },
  });
  expect(JSON.stringify(commands[0])).not.toContain('onHandMicros');
});

test('I2 edit archive and conversion commands keep independent optimistic versions', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { commands } = await mockInventory(page, { includePurchaseConversion: true });
  await page.goto('/inventory');
  await page
    .getByRole('region', { name: 'Inventory items' })
    .getByRole('button', { name: /Beef/ })
    .click();
  await page.getByRole('button', { name: 'Edit item' }).click();

  const editor = page.getByRole('region', { name: 'Edit inventory item' });
  await editor.getByLabel('Low-stock threshold (base units)').fill('0.000001');
  await editor.getByRole('button', { name: 'Save item' }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({
    type: 'item.update',
    entityId: itemId,
    expectedVersion: 7,
    payload: { lowStockThresholdMicros: 1, unitLabel: 'kg', trackingMode: 'RECIPE_TRACKED' },
  });

  await editor.getByRole('button', { name: 'Edit', exact: true }).click();
  await editor.getByLabel('Purchase unit label').fill('carton');
  await editor.getByLabel('Base units per purchase unit').fill('12.5');
  await editor.getByRole('button', { name: 'Save purchase unit' }).click();
  await expect.poll(() => commands.length).toBe(2);
  expect(commands[1]).toMatchObject({
    type: 'conversion.update',
    entityId: '66666666-6666-4666-8666-666666666667',
    expectedVersion: 3,
    payload: { purchaseUnitLabel: 'carton', baseMicrosPerPurchaseUnit: 12_500_000 },
  });

  await editor.getByRole('button', { name: 'Archive inventory item' }).click();
  await expect.poll(() => commands.length).toBe(3);
  expect(commands[2]).toMatchObject({
    type: 'item.archive',
    entityId: itemId,
    expectedVersion: 7,
    payload: {},
  });
});

test('inventory renders on-hand, reserved, available, history, and action entry points', async ({
  page,
}) => {
  await mockInventory(page);
  await page.goto('/inventory');

  await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();
  await page.getByRole('button', { name: /Beef/ }).click();

  const inspector = page.getByLabel('Inventory item detail');
  await expect(inspector.getByText('On hand', { exact: true })).toBeVisible();
  await expect(page.getByRole('definition').filter({ hasText: /^3\.2 kg$/ })).toBeVisible();
  await expect(inspector.getByText('Reserved', { exact: true })).toBeVisible();
  await expect(page.getByRole('definition').filter({ hasText: /^1\.1 kg$/ })).toBeVisible();
  await expect(inspector.getByText('Available', { exact: true })).toBeVisible();
  await expect(page.getByRole('definition').filter({ hasText: /^2\.1 kg$/ })).toBeVisible();
  await page.getByRole('tab', { name: 'Stock & movements' }).click();
  await expect(page.getByText('Bulk stock received')).toBeVisible();
  await page.getByRole('tab', { name: 'Overview' }).click();

  await expect(page.getByRole('button', { name: 'Adjust stock' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record waste' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stock count' })).toBeVisible();
  await page.getByText('More actions', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Transfer stock' })).toBeVisible();
});

test('inventory keeps inactive item history read-only without adjustment actions', async ({
  page,
}) => {
  await mockInventory(page, { itemActive: false });
  await page.goto('/inventory');

  await page.getByRole('button', { name: /Beef/ }).click();
  await page.getByRole('tab', { name: 'Stock & movements' }).click();
  await expect(page.getByText('Bulk stock received')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Adjust stock' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Record waste' })).toHaveCount(0);
});

test('inventory surfaces ordinary mutation conflicts to the operator', async ({ page }) => {
  await mockInventory(page, {
    failCommandType: 'adjust',
    failureCode: 'insufficient_stock',
  });
  await page.goto('/inventory');
  await page.getByRole('button', { name: /Beef/ }).click();

  await page.getByRole('button', { name: 'Adjust stock' }).click();
  await page.getByLabel('Quantity change').fill('-5');
  await page.getByLabel('Adjustment reason').selectOption(adjustmentReasonId);
  await page.getByRole('button', { name: 'Post adjustment' }).click();

  await expect(page.getByRole('alert')).toContainText(/not enough available stock/i);
});

test('inventory replaces an older mutation error with the most recent failure', async ({
  page,
}) => {
  await mockInventory(page, {
    failureCodesByCommand: {
      adjust: 'insufficient_stock',
      waste: 'waste_conflict',
    },
  });
  await page.goto('/inventory');
  await page.getByRole('button', { name: /Beef/ }).click();

  await page.getByRole('button', { name: 'Adjust stock' }).click();
  await page.getByLabel('Quantity change').fill('-5');
  await page.getByLabel('Adjustment reason').selectOption(adjustmentReasonId);
  await page.getByRole('button', { name: 'Post adjustment' }).click();
  await expect(page.getByRole('alert')).toContainText(/not enough available stock/i);

  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Record waste' }).click();
  await page.getByLabel('Waste quantity').fill('0.25');
  await page.getByLabel('Waste reason').selectOption(wasteReasonId);
  await page.getByRole('button', { name: 'Post waste' }).click();
  await expect(page.getByRole('alert')).toContainText(/inventory changed/i);
});

test('inventory clears an older mutation error after a later action succeeds', async ({ page }) => {
  await mockInventory(page, {
    failCommandType: 'adjust',
    failureCode: 'insufficient_stock',
  });
  await page.goto('/inventory');
  await page.getByRole('button', { name: /Beef/ }).click();

  await page.getByRole('button', { name: 'Adjust stock' }).click();
  await page.getByLabel('Quantity change').fill('-5');
  await page.getByLabel('Adjustment reason').selectOption(adjustmentReasonId);
  await page.getByRole('button', { name: 'Post adjustment' }).click();
  await expect(page.getByRole('alert')).toContainText(/not enough available stock/i);

  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Record waste' }).click();
  await page.getByLabel('Waste quantity').fill('0.25');
  await page.getByLabel('Waste reason').selectOption(wasteReasonId);
  await page.getByRole('button', { name: 'Post waste' }).click();

  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('I4 mobile replenishment rejects sub-micro policy values instead of silently rounding', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { commands } = await mockInventory(page);
  await page.goto('/inventory');
  await page.getByText('More actions', { exact: true }).click();
  await page.getByRole('button', { name: 'Reorder suggestions' }).click();
  await page.getByRole('button', { name: 'Edit policy for Beef' }).click();

  await page.getByLabel('Par level (kg)').fill('0.0000004');
  await page.getByRole('button', { name: 'Save policy' }).click();
  await expect(page.getByRole('alert')).toContainText('valid non-negative quantities');
  expect(commands).toHaveLength(0);

  await page.getByLabel('Par level (kg)').fill('0.000001');
  await page.getByRole('button', { name: 'Save policy' }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({
    type: 'replenishment.update',
    inventoryItemId: itemId,
    parLevelMicros: 1,
  });
});

test('replenishment save submits the workspace version the admin actually edited', async ({
  page,
}) => {
  const fixture = await mockInventory(page);
  await page.goto('/inventory');

  await page.getByText('More actions', { exact: true }).click();
  await page.getByRole('button', { name: 'Reorder suggestions' }).click();
  await page.getByRole('button', { name: 'Edit policy for Beef' }).click();
  await page.getByLabel('Par level (kg)').fill('3.5');
  await page.getByRole('button', { name: 'Save policy' }).click();

  await expect.poll(() => fixture.commands.length).toBe(1);
  expect(fixture.commands[0]).toMatchObject({
    type: 'replenishment.update',
    shopId,
    inventoryItemId: itemId,
    expectedVersion: 4,
    parLevelMicros: 3_500_000,
  });
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

test('I3 mobile Adjust and Waste sheets show the current available stock before posting', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockInventory(page);
  await page.goto('/inventory');
  await page
    .getByRole('region', { name: 'Inventory items' })
    .getByRole('button', { name: /Beef/ })
    .click();

  await page.getByRole('button', { name: 'Adjust stock' }).click();
  const adjust = page.getByRole('dialog', { name: 'Adjust stock' });
  await expect(adjust).toContainText('Beef · Available 2.1 kg');
  await expect(adjust.getByRole('button', { name: 'Post adjustment' })).toBeDisabled();
  await adjust.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Record waste' }).click();
  const waste = page.getByRole('dialog', { name: /Record waste/i });
  await expect(waste).toContainText('Beef · Available 2.1 kg');
  await expect(waste.getByRole('button', { name: 'Post waste' })).toBeDisabled();
});

test('I3 adjust and waste reject fractional micros instead of rounding a stock movement', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { commands } = await mockInventory(page);
  await page.goto('/inventory');
  await page
    .getByRole('region', { name: 'Inventory items' })
    .getByRole('button', { name: /Beef/ })
    .click();

  await page.getByRole('button', { name: 'Adjust stock' }).click();
  const adjustment = page.getByLabel('Quantity change');
  await adjustment.fill('0.0000005');
  await expect(page.getByRole('button', { name: 'Post adjustment' })).toBeDisabled();
  await adjustment.fill('-0.0000005');
  await expect(page.getByRole('button', { name: 'Post adjustment' })).toBeDisabled();
  await adjustment.fill('-0.000001');
  await expect(page.getByRole('button', { name: 'Post adjustment' })).toBeEnabled();
  await page.getByRole('button', { name: 'Post adjustment' }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({
    type: 'adjust',
    quantityDeltaMicros: -1,
    inventoryItemId: itemId,
    reasonCodeId: adjustmentReasonId,
  });

  await page.getByRole('button', { name: 'Record waste' }).click();
  const waste = page.getByLabel('Waste quantity');
  await waste.fill('0.0000005');
  await expect(page.getByRole('button', { name: 'Post waste' })).toBeDisabled();
  await waste.fill('0.0000001');
  await expect(page.getByRole('button', { name: 'Post waste' })).toBeDisabled();
  await waste.fill('0.000001');
  await expect(page.getByRole('button', { name: 'Post waste' })).toBeEnabled();
  await page.getByRole('button', { name: 'Post waste' }).click();
  await expect.poll(() => commands.length).toBe(2);
  expect(commands[1]).toMatchObject({
    type: 'waste',
    quantityMicros: 1,
    inventoryItemId: itemId,
    reasonCodeId: wasteReasonId,
  });
});

test('I3 mobile adjustment pending approval does not post stock or change shown balance', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { commands } = await mockInventory(page, { pendingAdjustment: true });
  await page.goto('/inventory');
  await page
    .getByRole('region', { name: 'Inventory items' })
    .getByRole('button', { name: /Beef/ })
    .click();
  await page.getByRole('button', { name: 'Adjust stock' }).click();

  await expect(page.getByRole('dialog', { name: 'Adjust stock' })).toBeVisible();
  await page.screenshot({ path: 'test-results/inventory-i3-adjust-mobile-390.png' });
  await page.getByLabel('Quantity change').fill('0.25');
  await page.getByLabel('Adjustment reason').selectOption(adjustmentReasonId);
  await page.getByRole('button', { name: 'Post adjustment' }).click();

  await expect(page.getByText(/Stock adjustment submitted for approval/)).toBeVisible();
  await expect(page.getByLabel('Inventory item detail').getByText('3.2 kg')).toBeVisible();
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({
    type: 'adjust',
    quantityDeltaMicros: 250_000,
    reasonCodeId: adjustmentReasonId,
  });
});

test('I3 rejected adjustment retains command ID for exact retry but changes it for new intent', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { commands } = await mockInventory(page, {
    failCommandType: 'adjust',
    failureCode: 'inventory_conflict',
  });
  await page.goto('/inventory');
  await page
    .getByRole('region', { name: 'Inventory items' })
    .getByRole('button', { name: /Beef/ })
    .click();
  await page.getByRole('button', { name: 'Adjust stock' }).click();
  await page.getByLabel('Quantity change').fill('0.5');
  const submit = page.getByRole('button', { name: 'Post adjustment' });
  await submit.click();
  await expect.poll(() => commands.length).toBe(1);
  await submit.click();
  await expect.poll(() => commands.length).toBe(2);
  expect(commands[0]?.commandId).toBe(commands[1]?.commandId);
  await page.getByLabel('Quantity change').fill('0.6');
  await submit.click();
  await expect.poll(() => commands.length).toBe(3);
  expect(commands[2]?.commandId).not.toBe(commands[1]?.commandId);
  await expect(page.getByLabel('Inventory item detail').getByText('3.2 kg')).toBeVisible();
});

test('I3 390px adjustment and waste dialogs keep labeled selects and action footers accessible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockInventory(page);
  await page.goto('/inventory');
  await page
    .getByRole('region', { name: 'Inventory items' })
    .getByRole('button', { name: /Beef/ })
    .click();

  for (const [openLabel, title, selectLabel, submitLabel, filename] of [
    ['Adjust stock', 'Adjust stock', 'Adjustment reason', 'Post adjustment', 'adjust'],
    ['Record waste', 'Record waste for Beef', 'Waste reason', 'Post waste', 'waste'],
  ] as const) {
    await page.getByRole('button', { name: openLabel }).click();
    const dialog = page.getByRole('dialog', { name: title });
    await expect(dialog).toBeVisible();
    const reasonText = dialog.getByText(selectLabel, { exact: true });
    const reasonInput = dialog.getByLabel(selectLabel);
    const labelBox = await reasonText.boundingBox();
    const inputBox = await reasonInput.boundingBox();
    expect(labelBox).not.toBeNull();
    expect(inputBox).not.toBeNull();
    expect(inputBox!.y).toBeGreaterThanOrEqual(labelBox!.y + labelBox!.height + 4);

    const footer = dialog.locator('.admin-dialog__footer');
    await expect(footer.getByRole('button', { name: submitLabel })).toBeVisible();
    await expect(footer.getByRole('button', { name: 'Cancel' })).toBeVisible();
    const dialogBox = await dialog.boundingBox();
    const footerBox = await footer.boundingBox();
    expect(dialogBox).not.toBeNull();
    expect(footerBox).not.toBeNull();
    expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(
      dialogBox!.y + dialogBox!.height + 1,
    );
    await page.screenshot({
      path: 'test-results/inventory-i3-' + filename + '-sheet-mobile-390.png',
    });
    await footer.getByRole('button', { name: 'Cancel' }).click();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('inventory stocktake shows business quantities and preserves count authority', async ({
  page,
}) => {
  const fixture = await mockInventory(page);
  await page.goto('/inventory');
  await page.getByRole('button', { name: 'Stock count' }).click();

  await expect(page.getByText('Expected stock')).toBeVisible();
  await expect(page.getByText('Captured when this count started')).toBeVisible();
  await expect(page.getByText('0 / 1 counted')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Post stock count' })).toBeDisabled();

  await page.getByLabel('Actual count for Beef').fill('3.0');
  await expect(page.getByText('1 / 1 counted')).toBeVisible();
  await expect(page.getByText('-0.2 kg')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Post stock count' })).toBeDisabled();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect.poll(() => fixture.commands.length).toBe(2);
  await expect(page.getByRole('button', { name: 'Post stock count' })).toBeEnabled();
  await page.getByRole('button', { name: 'Post stock count' }).click();

  await expect.poll(() => fixture.commands.length).toBe(3);
  expect(fixture.commands[0]).toMatchObject({
    type: 'stocktake.begin',
    shopId,
    inventoryItemIds: [itemId],
  });
  expect(fixture.commands[1]).toMatchObject({
    type: 'stocktake.save',
    shopId,
    stocktakeId: '99999999-9999-4999-8999-999999999999',
    expectedRevision: 0,
    lines: [{ inventoryItemId: itemId, actualCountMicros: 3_000_000 }],
  });
  expect(fixture.commands[2]).toMatchObject({
    type: 'stocktake.post',
    shopId,
    stocktakeId: '99999999-9999-4999-8999-999999999999',
    lines: [{ inventoryItemId: itemId, actualCountMicros: 3_000_000 }],
  });
});

test('I4 clears accepted mobile transfer draft to block repeat sends', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { commands } = await mockInventory(page);
  await page.goto('/inventory');
  await page.getByText('More actions', { exact: true }).click();
  await page.getByRole('button', { name: 'Transfer stock' }).click();
  await page.getByLabel('Quantity (base units)').fill('0.000001');
  await page.getByRole('button', { name: 'Add to transfer' }).click();
  await page.getByRole('button', { name: 'Review transfer' }).click();
  await page.getByRole('button', { name: 'Confirm send' }).click();

  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({ type: 'transfer.send' });
  await expect(page.getByRole('button', { name: 'Confirm send' })).toHaveCount(0);
  await expect(page.getByText('Draft items (0)')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('inventory can receive a sent inter-shop transfer without using purchasing receive', async ({
  page,
}) => {
  const fixture = await mockInventory(page);
  await page.goto('/inventory');
  await page.getByText('More actions', { exact: true }).click();
  await page.getByRole('button', { name: 'Transfer stock' }).click();

  await expect(page.getByText('Incoming sent transfers')).toBeVisible();
  await expect(page.getByText('0.4 kg Beef')).toBeVisible();
  await expect(page.getByText('From TUX Zamalek')).toBeVisible();
  await page.getByRole('button', { name: 'Receive transfer' }).click();

  await expect.poll(() => fixture.commands.length).toBe(1);
  expect(fixture.commands[0]).toMatchObject({
    type: 'transfer.receive',
    transferId: '77777777-7777-4777-8777-777777777777',
  });
});

for (const viewport of premiumVisualViewports([{ name: 'desktop', width: 1440, height: 900 }])) {
  test(
    'authorized owner explicitly creates an audited recipe inventory master binding at ' +
      viewport.width +
      'px',
    async ({ page }) => {
      await page.setViewportSize(viewport);
      await mockInventory(page);
      await page.route('**/api/admin/session', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ...ownerSession,
            principal: {
              ...ownerSession.principal,
              permissions: [...ownerSession.principal.permissions, 'catalog.edit'],
            },
          }),
        });
      });
      const recorded: Record<string, unknown>[] = [];
      const masterId = '88888888-8888-4888-8888-888888888888';
      await page.route('**/api/admin/inventory**', async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        if (req.method() === 'GET' && url.searchParams.get('view') === 'master-bindings') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              ok: true,
              shopId,
              masters: recorded.length
                ? [
                    {
                      id: masterId,
                      canonicalName: 'Business-wide beef',
                      baseUnitLabel: 'kg',
                      trackingMode: 'RECIPE_TRACKED',
                      inventoryItemId: itemId,
                      inventoryItemName: 'Beef',
                    },
                  ]
                : [],
            }),
          });
          return;
        }
        if (req.method() !== 'POST' || req.postDataJSON().type !== 'master.bind') {
          await route.fallback();
          return;
        }
        expect(req.headers()['x-tux-admin-csrf']).toBe(csrfToken);
        recorded.push(req.postDataJSON() as Record<string, unknown>);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            masterInventoryItemId: masterId,
            inventoryItemId: itemId,
            shopId,
            createdMaster: true,
          }),
        });
      });
      await page.goto('/inventory');
      await page.getByText('More actions', { exact: true }).click();
      await page.getByRole('button', { name: 'Manage recipe master bindings' }).click();
      await expect(
        page.getByRole('heading', { name: 'Recipe inventory master bindings' }),
      ).toBeVisible();
      await page.getByLabel('Master name').fill('Business-wide beef');
      await capturePremiumScreenshot(page, 'recipe-binding');
      await page.getByRole('button', { name: 'Save explicit mapping' }).click();
      await expect(page.getByText(/Already bound to Business-wide beef/)).toBeVisible();
      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({
        type: 'master.bind',
        shopId,
        inventoryItemId: itemId,
        masterInventoryItemId: null,
        canonicalName: 'Business-wide beef',
      });
      expect(recorded[0]?.commandId).toMatch(/^[0-9a-f-]{36}$/);
    },
  );
}

test('I2 restores an archived definition through the trusted versioned command', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { commands } = await mockInventory(page, {
    itemActive: false,
    includePurchaseConversion: true,
  });
  await page.goto('/inventory');
  await page
    .getByRole('region', { name: 'Inventory items' })
    .getByRole('button', { name: /Beef/ })
    .click();
  await page.getByRole('button', { name: 'Edit item' }).click();
  await page.getByRole('button', { name: 'Restore inventory item' }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({
    type: 'item.restore',
    entityId: itemId,
    expectedVersion: 7,
    payload: {},
  });
});

test('I2 creates exact micro conversion through trusted inventory definition command', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { commands } = await mockInventory(page);
  await page.goto('/inventory');
  await page
    .getByRole('region', { name: 'Inventory items' })
    .getByRole('button', { name: /Beef/ })
    .click();
  await page.getByRole('button', { name: 'Edit item' }).click();
  const editor = page.getByRole('region', { name: 'Edit inventory item' });
  await editor.getByRole('button', { name: 'Add purchase unit' }).click();
  await editor.getByLabel('Purchase unit label').fill('box');
  await editor.getByLabel('Base units per purchase unit').fill('12.000001');
  await editor.getByRole('button', { name: 'Save purchase unit' }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({
    type: 'conversion.create',
    entityId: null,
    expectedVersion: null,
    payload: {
      inventoryItemId: itemId,
      purchaseUnitLabel: 'box',
      baseMicrosPerPurchaseUnit: 12_000_001,
    },
  });
});

test('I2 recipe master controls stay hidden for Manager even with composite permissions', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockInventory(page);
  await page.route('**/api/admin/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...ownerSession,
        principal: {
          ...ownerSession.principal,
          role: 'MANAGER',
          permissions: [...ownerSession.principal.permissions, 'catalog.edit'],
        },
      }),
    });
  });
  await page.goto('/inventory');
  await page.getByText('More actions', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Manage recipe master bindings' })).toHaveCount(0);
});

test('I2 stale item detail link cannot expose a foreign inventory record or edit actions', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockInventory(page, { allowStaleItemHistory: true });
  await page.goto('/inventory/ffffffff-ffff-4fff-8fff-ffffffffffff');
  const detail = page.getByLabel('Inventory item detail');
  await expect(detail).toContainText('Inventory item unavailable');
  await expect(detail.getByRole('button', { name: 'Edit item' })).toHaveCount(0);
  await expect(detail.getByRole('button', { name: 'Adjust stock' })).toHaveCount(0);
});

test('I2 mobile master mapping clears incompatible preview after source-unit switch', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockInventory(page, { includeSecondTrackedItem: true });
  await page.route('**/api/admin/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...ownerSession,
        principal: {
          ...ownerSession.principal,
          permissions: [...ownerSession.principal.permissions, 'catalog.edit'],
        },
      }),
    });
  });
  const posted: unknown[] = [];
  await page.route('**/api/admin/inventory**', async (route) => {
    const request = route.request();
    if (
      request.method() === 'GET' &&
      new URL(request.url()).searchParams.get('view') === 'master-bindings'
    ) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          shopId,
          masters: [
            {
              id: '77777777-7777-4777-8777-777777777771',
              canonicalName: 'Beef master',
              baseUnitLabel: 'kg',
              trackingMode: 'RECIPE_TRACKED',
              inventoryItemId: null,
              inventoryItemName: null,
            },
            {
              id: '77777777-7777-4777-8777-777777777772',
              canonicalName: 'Rice master',
              baseUnitLabel: 'g',
              trackingMode: 'RECIPE_TRACKED',
              inventoryItemId: null,
              inventoryItemName: null,
            },
          ],
        }),
      });
      return;
    }
    if (request.method() === 'POST' && request.postDataJSON().type === 'master.bind') {
      posted.push(request.postDataJSON());
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      return;
    }
    await route.fallback();
  });

  await page.goto('/inventory');
  await page.getByText('More actions', { exact: true }).click();
  await page.getByRole('button', { name: 'Manage recipe master bindings' }).click();
  await page.getByLabel('Attach to an existing master').check();
  await page
    .getByLabel('Existing compatible master')
    .selectOption('77777777-7777-4777-8777-777777777771');
  const preview = page.getByRole('region', { name: 'Mapping review' });
  await expect(preview).toContainText('Beef master (kg)');

  await page.getByLabel('Shop inventory item').selectOption('99999999-9999-4999-8999-999999999998');
  await expect(preview).toContainText('Rice (g)');
  await expect(page.getByLabel('Existing compatible master')).toHaveValue('');
  await expect(preview).toContainText('Select a verified compatible master');
  await expect(preview).not.toContainText('Beef master (kg)');
  expect(posted).toHaveLength(0);
});

for (const viewport of premiumVisualViewports(ADMIN_CORE_VIEWPORTS)) {
  test(`inventory master-detail remains usable at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockInventory(page);
    await page.goto('/inventory');
    await expect(page.locator('.shop-switcher select option[value="' + shopId + '"]')).toHaveText(
      'TUX Maadi',
    );
    await expect(
      page.locator('.shop-switcher select option[value="' + otherShopId + '"]'),
    ).toContainText('TUX QA Shop B');

    const list = page.getByRole('region', { name: 'Inventory items' });
    await list.getByRole('button', { name: /Beef/ }).click();
    await expect(page.getByLabel('Inventory item detail')).toBeVisible();

    if (viewport.width <= 1150) {
      await expect(list).toBeHidden();
      await expect(page.getByRole('link', { name: /back to inventory/i })).toBeVisible();
    } else {
      await expect(list).toBeVisible();
    }

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await capturePremiumScreenshot(page, 'inventory');
  });
}

if (process.env['P04_P07_CAPTURE'] === '1') {
  for (const viewport of PREMIUM_EVIDENCE_VIEWPORTS) {
    test('inventory More actions menu scene at ' + viewport.width + 'px', async ({ page }) => {
      await page.setViewportSize(viewport);
      await mockInventory(page);
      await page.goto('/inventory');
      await page.getByText('More actions', { exact: true }).click();
      await expect(page.locator('details.admin-inventory-more-actions')).toHaveAttribute(
        'open',
        '',
      );
      await expect(page.getByRole('button', { name: 'Reorder suggestions' })).toBeVisible();
      await capturePremiumScreenshot(page, 'inventory-more-actions');
    });
  }
}

test('inventory More actions closes on Escape, outside click and workflow selection', async ({
  page,
}) => {
  await mockInventory(page);
  await page.goto('/inventory');
  const disclosure = page.locator('details.admin-inventory-more-actions');
  const more = page.getByText('More actions', { exact: true });

  await more.click();
  await expect(disclosure).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
  await expect(disclosure).not.toHaveAttribute('open');
  await expect(more).toBeFocused();

  await more.click();
  await page.getByRole('heading', { name: 'Inventory', exact: true }).click();
  await expect(disclosure).not.toHaveAttribute('open');

  await more.click();
  await page.getByRole('button', { name: 'Reorder suggestions' }).click();
  await expect(disclosure).not.toHaveAttribute('open');
  await expect(page.getByRole('heading', { name: 'Reorder suggestions' })).toBeVisible();
});

if (process.env['P04_P07_CAPTURE'] === '1') {
  for (const viewport of PREMIUM_EVIDENCE_VIEWPORTS) {
    test(`reorder policy editor scene at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const fixture = await mockInventory(page);
      await page.goto('/inventory');
      await page.getByText('More actions', { exact: true }).click();
      await page.getByRole('button', { name: 'Reorder suggestions' }).click();
      await page.getByRole('button', { name: 'Edit policy for Beef' }).click();
      await expect(page.getByLabel('Par level (kg)')).toBeVisible();
      const policyForm = page.locator('.admin-inventory-policy-form');
      await expect(policyForm).toBeVisible();
      expect(await policyForm.evaluate((node) => getComputedStyle(node).display)).toBe('grid');
      const parField = policyForm.getByLabel('Par level (kg)');
      expect(await parField.evaluate((node) => getComputedStyle(node).width)).not.toBe('auto');
      const savePolicy = policyForm.getByRole('button', { name: 'Save policy' });
      await savePolicy.scrollIntoViewIfNeeded();
      if (viewport.width <= 390) {
        const occluded = await page.evaluate(() => {
          const action = document.querySelector(
            '.admin-inventory-policy-form button[type="submit"]',
          );
          const nav = document.querySelector('.admin-mobile-tabs');
          if (!action || !nav) return true;
          const rect = action.getBoundingClientRect();
          const navRect = nav.getBoundingClientRect();
          return rect.bottom > navRect.top || rect.top < 0 || rect.right > window.innerWidth;
        });
        expect(occluded).toBe(false);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      expect(fixture.commands).toHaveLength(0);
      // Capture from the top after checking that the last action is accessible.
      // Fixed shell chrome would otherwise appear halfway down full-page PNGs.
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        window.scrollTo(0, 0);
      });
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      await capturePremiumScreenshot(page, 'reorder-policy');
    });
  }
}

if (process.env['P04_P07_TARGETED_CAPTURE'] === '1') {
  for (const width of [390, 1440] as const) {
    for (const theme of ['light', 'dark'] as const) {
      for (const entry of ['cold', 'warm'] as const) {
        test(`targeted P04 inventory ${theme} ${entry} ${width}px`, async ({ page }) => {
          await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
          await mockInventory(page);
          await verifyTargetedVisualLayout(page, {
            route: '/inventory',
            heading: 'Inventory',
            theme,
            entry,
          });
          await captureTargetedAcceptance(page, 'p04', 'inventory', theme, entry);
        });
      }
    }
  }
}

for (const width of [360, 1100] as const) {
  test(`inventory preserves approved single-pane navigation and no overflow at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 360 ? 800 : 940 });
    await mockInventory(page);
    await page.goto('/inventory');
    await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stock count' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible();

    const list = page.getByRole('region', { name: 'Inventory items' });
    await expect(list).toBeVisible();
    await list.getByRole('button', { name: /Beef/ }).click();
    await expect(list).toBeHidden();
    const inspector = page.getByLabel('Inventory item detail');
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole('link', { name: /back to inventory items/i })).toBeVisible();
    await inspector.getByRole('tab', { name: 'Stock & movements' }).click();
    await expect(inspector.getByText('Bulk stock received')).toBeVisible();
    await inspector.getByRole('tab', { name: 'Settings' }).click();
    await expect(
      inspector.getByRole('tabpanel', { name: 'Settings' }).getByText('Base unit', { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await inspector.getByRole('link', { name: /back to inventory items/i }).click();
    await expect(list).toBeVisible();
  });
}
