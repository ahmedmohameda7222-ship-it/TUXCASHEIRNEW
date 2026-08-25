import { pbkdf2Sync } from 'node:crypto';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

const SHOP = '10000000-0000-4000-8000-000000000001';
const WORKER = '20000000-0000-4000-8000-000000000001';
const WORKER_TWO = '20000000-0000-4000-8000-000000000002';
const DATABASE = 'tux-operations-v2';
const DRAFT_DATABASE = 'tux-operations-v2-drafts';

function uuid(prefix: string, index: number): string {
  return `${prefix}-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function pinHash(pin: string): string {
  const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const digest = pbkdf2Sync(pin, salt, 210_000, 32, 'sha256');
  return `pbkdf2-sha256$210000$${salt.toString('hex')}$${digest.toString('hex')}`;
}

function configuration() {
  const category = (index: number) => uuid('30000000', index);
  const product = (index: number) => uuid('40000000', index);
  const modifier = (index: number) => uuid('50000000', index);
  const inventory = (index: number) => uuid('60000000', index);
  const orderType = (index: number) => uuid('70000000', index);
  const payment = (index: number) => uuid('80000000', index);
  const products = [
    ['Classic Smash', 12_000, 1, false, false],
    ['Double Smash', 16_000, 1, false, false],
    ['Triple Smash', 20_000, 1, false, false],
    ['TUX Loaded Burger', 22_000, 1, false, false],
    ['Crispy Chicken', 14_000, 1, false, false],
    ['Spicy Chicken', 15_000, 1, false, false],
    ['Combo Smash + Required Beverage', 19_000, 1, true, false],
    ['Long Name Layout Stress Burger with Extra Description', 21_000, 1, false, false],
    ['Sold Out Test Burger', 17_000, 1, false, true],
    ['Fries', 5_000, 2, false, false],
    ['Loaded Fries', 8_000, 2, false, false],
    ['Onion Rings', 6_000, 2, false, false],
    ['Cola', 3_000, 3, false, false],
    ['Diet Cola', 3_000, 3, false, false],
    ['Water', 2_000, 3, false, false],
    ['Orange Soda', 3_000, 3, false, false],
    ['Lemon Soda', 3_000, 3, false, false],
    ['Iced Tea', 4_000, 3, false, false],
  ].map(([name, priceMinor, categoryIndex, isCombo, soldOut], index) => ({
    id: product(index + 1),
    shopId: SHOP,
    categoryId: category(Number(categoryIndex)),
    name: String(name),
    description:
      index === 7 ? 'Development-only long text used to stress responsive menu layout.' : null,
    priceMinor: Number(priceMinor),
    imageKey: null,
    active: true,
    soldOut: Boolean(soldOut),
    isCombo: Boolean(isCombo),
    sortOrder: index,
  }));
  const inventoryItems = [
    { id: inventory(1), name: 'Beef Patty', unitLabel: 'portion', trackingMode: 'RECIPE_TRACKED' },
    {
      id: inventory(2),
      name: 'Chicken Fillet',
      unitLabel: 'portion',
      trackingMode: 'RECIPE_TRACKED',
    },
    { id: inventory(3), name: 'Burger Bun', unitLabel: 'piece', trackingMode: 'RECIPE_TRACKED' },
    { id: inventory(4), name: 'Fries Bulk Bag', unitLabel: 'bag', trackingMode: 'BULK_MANUAL' },
    { id: inventory(5), name: 'Packaging Box', unitLabel: 'box', trackingMode: 'BULK_MANUAL' },
  ].map((item) => ({ ...item, shopId: SHOP, active: true }));
  return {
    snapshot: {
      shopId: SHOP,
      version: 1,
      updatedAt: '2026-08-20T03:00:00.000Z',
      categories: [
        { id: category(1), shopId: SHOP, name: 'Burgers', sortOrder: 0, active: true },
        { id: category(2), shopId: SHOP, name: 'Sides', sortOrder: 1, active: true },
        { id: category(3), shopId: SHOP, name: 'Drinks', sortOrder: 2, active: true },
      ],
      products,
      modifiers: [
        {
          id: modifier(1),
          shopId: SHOP,
          name: 'Extra Cheese',
          priceMinor: 2_000,
          standaloneProductId: null,
          active: true,
          sortOrder: 0,
        },
        {
          id: modifier(2),
          shopId: SHOP,
          name: 'Extra Patty',
          priceMinor: 4_000,
          standaloneProductId: null,
          active: true,
          sortOrder: 1,
        },
        {
          id: modifier(3),
          shopId: SHOP,
          name: 'No Onion',
          priceMinor: 0,
          standaloneProductId: null,
          active: true,
          sortOrder: 2,
        },
      ],
      productModifierLinks: [
        {
          shopId: SHOP,
          productId: product(1),
          modifierId: modifier(1),
          maxQuantity: 2,
          sortOrder: 0,
        },
        {
          shopId: SHOP,
          productId: product(1),
          modifierId: modifier(2),
          maxQuantity: 3,
          sortOrder: 1,
        },
        {
          shopId: SHOP,
          productId: product(1),
          modifierId: modifier(3),
          maxQuantity: 1,
          sortOrder: 2,
        },
      ],
      comboBeverageOptions: [13, 14, 15, 16, 17, 18].map((beverageIndex, sortOrder) => ({
        shopId: SHOP,
        comboProductId: product(7),
        beverageProductId: product(beverageIndex),
        sortOrder,
      })),
      recipeLines: [
        {
          shopId: SHOP,
          productId: product(1),
          inventoryItemId: inventory(1),
          quantityMicros: 1_000_000,
        },
        {
          shopId: SHOP,
          productId: product(1),
          inventoryItemId: inventory(3),
          quantityMicros: 1_000_000,
        },
        {
          shopId: SHOP,
          productId: product(5),
          inventoryItemId: inventory(2),
          quantityMicros: 1_000_000,
        },
        {
          shopId: SHOP,
          productId: product(5),
          inventoryItemId: inventory(3),
          quantityMicros: 1_000_000,
        },
      ],
      orderTypes: [
        {
          id: orderType(1),
          shopId: SHOP,
          name: 'Take Away',
          behavior: 'TAKE_AWAY',
          sortOrder: 0,
          active: true,
        },
        {
          id: orderType(2),
          shopId: SHOP,
          name: 'Dine In',
          behavior: 'DINE_IN',
          sortOrder: 1,
          active: true,
        },
        {
          id: orderType(3),
          shopId: SHOP,
          name: 'Delivery',
          behavior: 'DELIVERY',
          sortOrder: 2,
          active: true,
        },
      ],
      paymentMethods: [
        {
          id: payment(1),
          shopId: SHOP,
          displayName: 'Cash',
          logicType: 'CASH',
          requiresReconciliation: true,
          sortOrder: 0,
          active: true,
        },
        {
          id: payment(2),
          shopId: SHOP,
          displayName: 'Instapay',
          logicType: 'DIGITAL',
          requiresReconciliation: true,
          sortOrder: 1,
          active: true,
        },
      ],
      deliveryZones: [
        {
          id: uuid('90000000', 1),
          shopId: SHOP,
          name: 'Downtown Demo',
          feeMinor: 3_500,
          sortOrder: 0,
          active: true,
        },
        {
          id: uuid('90000000', 2),
          shopId: SHOP,
          name: 'Outer Demo Zone',
          feeMinor: 5_000,
          sortOrder: 1,
          active: true,
        },
      ],
    },
    inventoryItems,
  };
}

async function seedBrowserFallback(page: Page): Promise<void> {
  const fixture = configuration();
  await page.route('**/__tux_e2e_seed__', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>seed</title>',
    });
  });
  await page.goto('/__tux_e2e_seed__');
  await page.evaluate(
    async ({
      databaseName,
      draftDatabaseName,
      shopId,
      workerId,
      workerTwoId,
      workerPinHash,
      workerTwoPinHash,
      bundle,
    }) => {
      const deleteDatabase = (name: string) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
          request.onblocked = () => reject(new Error(`Delete blocked for ${name}`));
        });
      await Promise.all([deleteDatabase(databaseName), deleteDatabase(draftDatabaseName)]);
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          const shops = db.createObjectStore('shops', { keyPath: 'id' });
          shops.createIndex('active', 'active');
          const devices = db.createObjectStore('devices', { keyPath: 'id' });
          devices.createIndex('shopId', 'shopId');
          const workers = db.createObjectStore('workers', { keyPath: 'id' });
          workers.createIndex('shopId', 'shopId');
          db.createObjectStore('workerSessions', { keyPath: 'id' });
          db.createObjectStore('configurationSnapshots', { keyPath: 'shopId' });
          const contacts = db.createObjectStore('customerContacts', { keyPath: 'id' });
          contacts.createIndex('shopPhone', ['shopId', 'normalizedPhone'], { unique: true });
          const days = db.createObjectStore('businessDays', { keyPath: 'id' });
          days.createIndex('shopStatus', ['shopId', 'status']);
          const orders = db.createObjectStore('orders', { keyPath: 'id' });
          orders.createIndex('shopIdempotency', ['shopId', 'idempotencyKey'], { unique: true });
          orders.createIndex('businessDayStatus', ['businessDayId', 'status']);
          const expenses = db.createObjectStore('expenses', { keyPath: 'id' });
          expenses.createIndex('businessDayId', 'businessDayId');
          const inventoryItems = db.createObjectStore('inventoryItems', { keyPath: 'id' });
          inventoryItems.createIndex('shopTrackingMode', ['shopId', 'trackingMode']);
          const movements = db.createObjectStore('inventoryMovements', { keyPath: 'id' });
          movements.createIndex('shopIdempotency', ['shopId', 'idempotencyKey'], { unique: true });
          const reconciliations = db.createObjectStore('reconciliations', { keyPath: 'id' });
          reconciliations.createIndex('shopBusinessDay', ['shopId', 'businessDayId'], {
            unique: true,
          });
          db.createObjectStore('auditEvents', { keyPath: 'id' });
          const outbox = db.createObjectStore('outboxEvents', { keyPath: 'id' });
          outbox.createIndex('shopIdempotency', ['shopId', 'idempotencyKey'], { unique: true });
          outbox.createIndex('deliveredAt', 'deliveredAt');
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(
          ['shops', 'workers', 'configurationSnapshots', 'inventoryItems'],
          'readwrite',
        );
        tx.objectStore('shops').put({ id: shopId, name: 'TUX E2E Shop', active: true });
        tx.objectStore('workers').put({
          id: workerId,
          shopId,
          displayName: 'Demo Worker One',
          pinHash: workerPinHash,
          active: true,
        });
        tx.objectStore('workers').put({
          id: workerTwoId,
          shopId,
          displayName: 'Demo Worker Two',
          pinHash: workerTwoPinHash,
          active: true,
        });
        tx.objectStore('configurationSnapshots').put(bundle.snapshot);
        for (const item of bundle.inventoryItems) tx.objectStore('inventoryItems').put(item);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      database.close();
    },
    {
      databaseName: DATABASE,
      draftDatabaseName: DRAFT_DATABASE,
      shopId: SHOP,
      workerId: WORKER,
      workerTwoId: WORKER_TWO,
      workerPinHash: pinHash('1234'),
      workerTwoPinHash: pinHash('5678'),
      bundle: fixture,
    },
  );
  await page.unroute('**/__tux_e2e_seed__');
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    )
    .toBe(true);
}

async function waitForActiveShell(page: Page): Promise<void> {
  await expect(page.getByRole('navigation', { name: 'Operations' })).toBeVisible({
    timeout: 15_000,
  });
}

async function setAppearance(page: Page, theme: 'Light' | 'Dark'): Promise<void> {
  const operator = page.getByRole('button', { name: /Demo Worker One/ });
  await operator.click();
  await page.getByRole('button', { name: theme, exact: true }).click();
  await operator.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme.toLowerCase());
}

async function captureVisualEvidence(page: Page, testInfo: TestInfo): Promise<void> {
  await setAppearance(page, 'Light');
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath('operations-light.png'),
    animations: 'disabled',
    caret: 'hide',
  });

  await setAppearance(page, 'Dark');
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath('operations-dark.png'),
    animations: 'disabled',
    caret: 'hide',
  });

  await setAppearance(page, 'Light');
}

async function openCartIfMobile(page: Page, testInfo: TestInfo): Promise<void> {
  if (testInfo.project.name.startsWith('mobile')) {
    await page.getByRole('button', { name: /Review & pay/ }).click();
    await expect(page.locator('.mobile-cart-overlay')).toBeVisible();
  }
}

function currentOrderCart(page: Page, testInfo: TestInfo): Locator {
  const container = testInfo.project.name.startsWith('mobile')
    ? page.locator('.mobile-cart-overlay')
    : page.locator('.desktop-cart-wrap');
  return container.getByRole('complementary', { name: 'Current order' });
}

async function closeMobileCartIfOpen(page: Page, testInfo: TestInfo): Promise<void> {
  if (testInfo.project.name.startsWith('mobile')) {
    const overlay = page.locator('.mobile-cart-overlay');
    if (await overlay.isVisible().catch(() => false)) {
      await overlay.getByRole('button', { name: 'Close' }).click();
    }
  }
}

async function expectOrderPlaced(page: Page): Promise<void> {
  await expect(page.getByRole('status').filter({ hasText: /Placed order #\d+/ })).toBeVisible();
}

async function addClassicWithModifier(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Quick Info for Classic Smash' }).click();
  await page.getByRole('button', { name: 'Customize & add' }).click();
  await page.getByRole('button', { name: 'Add one Extra Cheese' }).click();
  await page.getByRole('button', { name: 'Add to order' }).click();
}

async function placeCashOrder(page: Page, testInfo: TestInfo): Promise<void> {
  await addClassicWithModifier(page);
  await captureVisualEvidence(page, testInfo);
  await openCartIfMobile(page, testInfo);
  const cart = currentOrderCart(page, testInfo);
  await cart.getByRole('button', { name: 'Cash', exact: true }).click();
  await cart.getByLabel('Cash received').fill('200');
  await cart.getByLabel('Cash received').blur();
  await cart.getByRole('button', { name: 'Place Order' }).click();
  await expectOrderPlaced(page);
  await closeMobileCartIfOpen(page, testInfo);
}

async function placeDeliveryInstapayOrder(page: Page, testInfo: TestInfo): Promise<void> {
  await page.getByRole('button', { name: 'Add one Double Smash' }).click();
  await openCartIfMobile(page, testInfo);
  const cart = currentOrderCart(page, testInfo);
  await cart.getByRole('button', { name: 'Delivery', exact: true }).click();
  await cart.getByLabel('Phone').fill('01012345678');
  await cart.getByLabel('Phone').blur();
  await cart.getByLabel('Customer name').fill('Mona Adel');
  await cart.getByLabel('Customer name').blur();
  await cart.getByLabel('Zone').selectOption({ value: uuid('90000000', 1) });
  await cart.getByLabel('Full address').fill('12 Nile Street, Cairo');
  await cart.getByLabel('Full address').blur();
  await cart.getByRole('button', { name: 'Instapay', exact: true }).click();
  await cart.getByRole('button', { name: 'Place Order' }).click();
  await expectOrderPlaced(page);
  await closeMobileCartIfOpen(page, testInfo);
}

async function placeSplitComboOrder(page: Page, testInfo: TestInfo): Promise<void> {
  await page.getByRole('button', { name: 'Add one Combo Smash + Required Beverage' }).click();
  const customizer = page.getByRole('dialog', { name: 'Combo Smash + Required Beverage' });
  await customizer.getByRole('combobox').selectOption({ label: 'Cola' });
  await customizer.getByRole('button', { name: 'Add to order' }).click();
  await openCartIfMobile(page, testInfo);
  const cart = currentOrderCart(page, testInfo);
  await cart.getByRole('button', { name: 'Split payment' }).click();
  await cart.getByLabel('Amount A').fill('50');
  await cart.getByLabel('Amount A').blur();
  await cart.getByLabel('Cash received A').fill('50');
  await cart.getByLabel('Cash received A').blur();
  await cart.getByRole('button', { name: 'Place Order' }).click();
  await expectOrderPlaced(page);
  await closeMobileCartIfOpen(page, testInfo);
}

async function resolveBoardAndExerciseExceptions(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Orders Board', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Orders Board' })).toBeVisible();
  const active = page.getByLabel('Active orders');
  await expect(active).toBeVisible();

  const firstCancel = active.getByRole('button', { name: 'Cancel', exact: true }).first();
  await firstCancel.click();
  const cancelDialog = page.getByRole('dialog', { name: /Order #/ });
  await cancelDialog.getByRole('button', { name: 'No · Restore Stock' }).click();
  await cancelDialog.getByLabel('Reason').fill('E2E customer cancellation');
  await cancelDialog.getByRole('button', { name: 'Confirm Cancellation' }).click();
  await expect(page.getByRole('tab', { name: /Cancelled/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await page.getByRole('tab', { name: /Active/ }).click();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const emptyState = page.getByText('No active orders', { exact: true });
    if (await emptyState.isVisible().catch(() => false)) break;

    const button = page
      .getByLabel('Active orders')
      .getByRole('button', { name: 'Mark Done' })
      .first();
    await expect(button).toBeEnabled({ timeout: 10_000 });
    await button.click();
    await expect(
      page.getByRole('status').filter({ hasText: /Order #\d+ marked Done\./ }),
    ).toBeVisible();
  }
  await expect(page.getByText('No active orders', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: /Done/ }).click();
  const deliveryDoneRow = page.locator('.history-row').filter({ hasText: 'Delivery' }).first();
  await deliveryDoneRow.click();
  const details = page.getByRole('dialog', { name: /Order #/ });
  await details.getByRole('button', { name: 'Delivery Failed' }).click();
  const returnDialog = page.getByRole('dialog', { name: /Order #/ }).last();
  await returnDialog.getByLabel('Reason').fill('E2E customer unavailable');
  await returnDialog.getByRole('button', { name: 'Confirm Delivery Failed' }).click();
  await expect(page.getByRole('tab', { name: /Returned/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
}

async function exerciseExpenses(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Expenses', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Expenses' })).toBeVisible();
  await page.getByLabel('Description').fill('Packaging bags');
  await page.getByLabel('Amount').fill('25');
  await page.getByLabel('Amount').blur();
  await page.getByRole('button', { name: 'Add Expense' }).click();
  await expect(page.getByText('Expense saved locally.')).toBeVisible();
  await expect(page.getByText('Packaging bags')).toBeVisible();
  await expect(page.getByText(/Delivery Failed/).first()).toBeVisible();
}

async function exerciseBulkStock(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Bulk Stock', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bulk Stock' })).toBeVisible();
  const card = page.locator('.bulk-stock-card').filter({ hasText: 'Fries Bulk Bag' });
  await card.getByRole('button', { name: 'Add Stock' }).click();
  const dialog = page.getByRole('dialog', { name: /Add Stock — Fries Bulk Bag/ });
  await dialog.getByLabel('Whole units received').fill('10');
  await dialog.getByRole('button', { name: 'Add Stock' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: /Fries Bulk Bag: added 10/ }),
  ).toBeVisible();
  await expect(card.locator('.bulk-stock-balance')).toContainText('10');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(card.locator('.bulk-stock-balance')).toContainText('0');
}

async function closeBusinessDay(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Demo Worker One/ }).click();
  await page.getByRole('menuitem', { name: 'End Day' }).click();
  const dialog = page.getByRole('dialog', { name: 'End Day' });
  await expect(dialog.getByRole('heading', { name: 'Enter actual Cash' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByRole('heading', { name: 'Enter actual Instapay' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Reveal Reconciliation' }).click();
  await expect(dialog.getByText('Final Closing Summary')).toBeVisible();
  const reasons = dialog.locator('textarea[id^="end-day-reason-"]');
  const count = await reasons.count();
  for (let index = 0; index < count; index += 1)
    await reasons.nth(index).fill('E2E count variance');
  await dialog.getByRole('button', { name: 'Close Business Day' }).click();
  await expect(page.getByText('No active Business Day')).toBeVisible();
}

test('Operations V2 full browser-fallback workflow stays durable and responsive', async ({
  page,
}, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await seedBrowserFallback(page);
  await page.goto('/');
  await expect(page.getByText('No active Business Day')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByLabel('Enter PIN to Start Day').fill('1234');
  await page.getByRole('button', { name: 'Start Day' }).click();
  await waitForActiveShell(page);
  await expect(page.getByRole('img', { name: 'TUX' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add one Sold Out Test Burger' })).toBeDisabled();
  await expectNoHorizontalOverflow(page);

  await placeCashOrder(page, testInfo);
  await placeDeliveryInstapayOrder(page, testInfo);
  await placeSplitComboOrder(page, testInfo);
  await resolveBoardAndExerciseExceptions(page);
  await exerciseExpenses(page);
  await exerciseBulkStock(page);
  await closeBusinessDay(page);
  await expectNoHorizontalOverflow(page);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

async function enterActiveOrdersForCategoryTests(page: Page): Promise<void> {
  await seedBrowserFallback(page);
  await page.goto('/');
  await page.getByLabel('Enter PIN to Start Day').fill('1234');
  await page.getByRole('button', { name: 'Start Day' }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('.welcome-action') !== null ||
      document.querySelector('[aria-label="Operations"]') !== null,
  );
  const welcomeAction = page.locator('.welcome-action');
  if (await welcomeAction.isVisible().catch(() => false)) await welcomeAction.click();
  await waitForActiveShell(page);
}

test('category search is progressive and keyboard accessible', async ({ page }) => {
  await enterActiveOrdersForCategoryTests(page);

  const searchInput = page.getByPlaceholder('Search products');
  const searchButton = page.getByRole('button', { name: 'Search menu' });
  await expect(searchInput).toBeHidden();
  await expect(searchButton).toBeVisible();

  await page.keyboard.press('Control+K');
  await expect(searchInput).toBeVisible();
  await expect(searchInput).toBeFocused();
  await searchInput.fill('cola');
  await expect(page.getByRole('button', { name: 'Add one Cola' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(searchInput).toHaveValue('');
  await expect(searchInput).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(searchInput).toBeHidden();

  await page.keyboard.press('/');
  await expect(searchInput).toBeVisible();
  await expect(searchInput).toBeFocused();
  await searchInput.fill('water');
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(searchInput).toBeHidden();
});

test('category editor persists alignment and keyboard reorder', async ({ page }) => {
  await enterActiveOrdersForCategoryTests(page);

  const searchButton = page.getByRole('button', { name: 'Search menu' });
  const editButton = page.getByRole('button', { name: 'Edit categories' });
  await expect(editButton).toBeVisible();
  await editButton.click();
  await expect(searchButton).toBeHidden();
  await expect(page.getByRole('group', { name: 'Category alignment' })).toBeVisible();

  await page.getByRole('button', { name: 'Right', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Right', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  const editorItems = page.locator('.category-editor-item');
  await expect(editorItems).toHaveCount(3);
  await expect(editorItems.nth(0)).toContainText('Burgers');
  await page.getByRole('button', { name: 'Move Burgers right' }).click();
  await expect(editorItems.nth(0)).toContainText('Sides');
  await expect(editorItems.nth(1)).toContainText('Burgers');

  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const categories = page.getByLabel('Menu categories').locator('.category-tab');
  await expect(categories.nth(0)).toHaveText('Sides');
  await expect(categories.nth(1)).toHaveText('Burgers');
  await expect(page.getByLabel('Menu categories')).toHaveAttribute('data-alignment', 'right');

  await page.reload();
  await waitForActiveShell(page);
  const reloadedCategories = page.getByLabel('Menu categories').locator('.category-tab');
  await expect(reloadedCategories.nth(0)).toHaveText('Sides');
  await expect(reloadedCategories.nth(1)).toHaveText('Burgers');
  await expect(page.getByLabel('Menu categories')).toHaveAttribute('data-alignment', 'right');

  await page.getByRole('button', { name: 'Edit categories' }).click();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const resetCategories = page.getByLabel('Menu categories').locator('.category-tab');
  await expect(resetCategories.nth(0)).toHaveText('Burgers');
  await expect(page.getByLabel('Menu categories')).toHaveAttribute('data-alignment', 'center');
});

test('category persistence failure keeps editor and draft intact', async ({ page }) => {
  await enterActiveOrdersForCategoryTests(page);

  await page.getByRole('button', { name: 'Add one Classic Smash' }).click();
  const cart = page.locator('.desktop-cart-wrap').getByRole('complementary', {
    name: 'Current order',
  });
  await expect(cart).toContainText('Classic Smash');

  await page.getByRole('button', { name: 'Edit categories' }).click();
  await page.getByRole('button', { name: 'Right', exact: true }).click();

  await page.evaluate(() => {
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function forcedPreferenceWriteFailure(
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (this.name === 'workerUiPreferences') {
        throw new DOMException('Forced preference write failure', 'AbortError');
      }
      return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
    };
  });

  await page.getByRole('button', { name: 'Done', exact: true }).click();

  await expect(page.getByRole('alert')).toHaveText('Could not save category layout. Try again.');
  await expect(page.getByLabel('Edit categories')).toBeVisible();
  await expect(cart).toContainText('Classic Smash');
});

test('Extra shortcuts preserve customized pricing and fresh adds', async ({ page }, testInfo) => {
  await enterActiveOrdersForCategoryTests(page);

  const classicCard = page.locator('.product-card').filter({ hasText: 'Classic Smash' }).first();
  const doubleCard = page.locator('.product-card').filter({ hasText: 'Double Smash' }).first();
  await expect(classicCard.getByRole('button', { name: 'Extra', exact: true })).toBeVisible();
  await expect(doubleCard.getByRole('button', { name: 'Extra', exact: true })).toHaveCount(0);

  await classicCard.getByRole('button', { name: 'Extra', exact: true }).click();
  const addDialog = page.getByRole('dialog', { name: 'Classic Smash' });
  const addExtrasSection = addDialog.locator('[aria-labelledby="extras-title"]');
  await expect(addExtrasSection).toBeFocused();
  await addDialog.getByRole('button', { name: 'Add one Extra Cheese' }).click();
  await addDialog.getByRole('button', { name: 'Add one Extra Cheese' }).click();
  await addDialog.getByRole('button', { name: 'Add one Extra Patty' }).click();
  await addDialog.getByRole('button', { name: 'Add to order' }).click();

  await expect(classicCard.locator('.product-quantity-badge')).toHaveText('1');
  await openCartIfMobile(page, testInfo);
  const cart = currentOrderCart(page, testInfo);
  const classicLines = cart.locator('.cart-line').filter({ hasText: 'Classic Smash' });
  await expect(classicLines).toHaveCount(1);
  await expect(classicLines.nth(0)).toContainText('2× Extra Cheese');
  await expect(classicLines.nth(0)).toContainText('1× Extra Patty');
  await expect(classicLines.nth(0)).toContainText(/200\.00/);

  await closeMobileCartIfOpen(page, testInfo);
  await classicCard.getByRole('button', { name: 'Add one Classic Smash' }).click();
  await expect(classicCard.locator('.product-quantity-badge')).toHaveText('2');
  await openCartIfMobile(page, testInfo);
  await expect(classicLines).toHaveCount(2);
  await expect(classicLines.nth(1)).not.toContainText('Extra Cheese');
  await expect(classicLines.nth(1)).not.toContainText('Extra Patty');
  await expect(classicLines.nth(1)).toContainText(/120\.00/);

  await classicLines.nth(0).getByRole('button', { name: 'Extra', exact: true }).click();
  const editDialog = page.getByRole('dialog', { name: 'Classic Smash' });
  await expect(editDialog.locator('[aria-labelledby="extras-title"]')).toBeFocused();
  await editDialog.getByRole('button', { name: 'Add one Extra Patty' }).click();
  await editDialog.getByRole('button', { name: 'Save item' }).click();

  const updatedLines = cart.locator('.cart-line').filter({ hasText: 'Classic Smash' });
  await expect(updatedLines).toHaveCount(2);
  await expect(updatedLines.nth(0)).toContainText('2× Extra Patty');
  await expect(updatedLines.nth(0)).toContainText(/240\.00/);
  await expect(updatedLines.nth(1)).not.toContainText('Extra Patty');
});

test('Current Order keeps cashier controls attached to each line', async ({ page }, testInfo) => {
  await enterActiveOrdersForCategoryTests(page);
  await addClassicWithModifier(page);
  await openCartIfMobile(page, testInfo);

  const cart = currentOrderCart(page, testInfo);
  const sectionTitles = await cart
    .locator('.cart-section > h2, .cart-section .section-heading-row > h2')
    .allTextContents();
  expect(sectionTitles.slice(0, 4)).toEqual(['Items', 'Order type', 'Notes & discount', 'Payment']);

  const title = cart.locator('.cart-title');
  const count = cart.locator('.cart-count');
  await expect(title).toHaveText('Current Order');
  await expect(count).toHaveText('1 item');
  expect(await title.evaluate((node) => getComputedStyle(node).fontSize)).toBe('17px');
  expect(await title.evaluate((node) => getComputedStyle(node).lineHeight)).toBe('22px');
  expect(await count.evaluate((node) => getComputedStyle(node).fontSize)).toBe('13px');
  expect(await count.evaluate((node) => getComputedStyle(node).lineHeight)).toBe('16px');

  const lines = cart.locator('.cart-line').filter({ hasText: 'Classic Smash' });
  await expect(lines).toHaveCount(1);
  const line = lines.first();
  await expect(line).toContainText('1× Extra Cheese');
  await expect(line.getByRole('button', { name: '−1', exact: true })).toBeVisible();
  await expect(line.getByRole('button', { name: '+1', exact: true })).toBeVisible();
  await expect(line.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await expect(line.getByRole('button', { name: 'Extra', exact: true })).toBeVisible();

  await line.getByRole('button', { name: '+1', exact: true }).click();
  await expect(lines).toHaveCount(1);
  await expect(lines.first()).toContainText('× 2');
  await expect(lines.first()).toContainText('1× Extra Cheese');

  await lines.first().getByRole('button', { name: '−1', exact: true }).click();
  await expect(lines.first()).toContainText('× 1');
  await expect(page.getByRole('status')).toContainText('Removed one Classic Smash');

  await lines.first().getByRole('button', { name: 'Edit', exact: true }).click();
  const editDialog = page.getByRole('dialog', { name: 'Classic Smash' });
  await expect(editDialog).toBeVisible();
  await expect(editDialog.getByText('Extra Cheese')).toBeVisible();
  await editDialog.getByRole('button', { name: 'Cancel' }).click();

  const cartDisplay = await cart.evaluate((node) => getComputedStyle(node).display);
  expect(cartDisplay).toBe('grid');
  const cartScroll = cart.locator('.cart-scroll');
  const totals = cart.locator('.cart-totals');
  const [scrollBox, totalsBox] = await Promise.all([
    cartScroll.boundingBox(),
    totals.boundingBox(),
  ]);
  expect(scrollBox).not.toBeNull();
  expect(totalsBox).not.toBeNull();
  expect(scrollBox!.y + scrollBox!.height).toBeLessThanOrEqual(totalsBox!.y + 1);
});
