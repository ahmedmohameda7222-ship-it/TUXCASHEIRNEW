import {
  capturePremiumScreenshot,
  premiumVisualViewports,
  PREMIUM_EVIDENCE_VIEWPORTS,
} from './premiumVisualEvidence';
import { expect, test, type Page, type Route } from '@playwright/test';
import { ADMIN_CORE_VIEWPORTS } from './adminViewports';

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
      const requestedInventoryItemId = url.searchParams.get('inventoryItemId');
      if (requestedInventoryItemId !== null) {
        expect(requestedInventoryItemId).toBe(itemId);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            inventoryItemId: itemId,
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

test('inventory renders on-hand, reserved, available, history, and action entry points', async ({
  page,
}) => {
  await mockInventory(page);
  await page.goto('/inventory');

  await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();
  await page.getByRole('button', { name: /Beef/ }).click();

  await expect(page.getByText('On Hand', { exact: true })).toBeVisible();
  await expect(page.getByRole('definition').filter({ hasText: /^3\.2 kg$/ })).toBeVisible();
  await expect(page.getByText('Reserved', { exact: true })).toBeVisible();
  await expect(page.getByRole('definition').filter({ hasText: /^1\.1 kg$/ })).toBeVisible();
  await expect(page.getByText('Available', { exact: true })).toBeVisible();
  await expect(page.getByRole('definition').filter({ hasText: /^2\.1 kg$/ })).toBeVisible();
  await expect(page.getByText('BULK STOCK RECEIVED')).toBeVisible();

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
  await expect(page.getByText('BULK STOCK RECEIVED')).toBeVisible();
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
  await page.getByRole('button', { name: 'Post stock count' }).click();

  await expect.poll(() => fixture.commands.length).toBe(2);
  expect(fixture.commands[0]).toMatchObject({
    type: 'stocktake.begin',
    shopId,
    inventoryItemIds: [itemId],
  });
  expect(fixture.commands[1]).toMatchObject({
    type: 'stocktake.post',
    shopId,
    stocktakeId: '99999999-9999-4999-8999-999999999999',
    lines: [{ inventoryItemId: itemId, actualCountMicros: 3_000_000 }],
  });
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

    if (viewport.width <= 480) {
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
