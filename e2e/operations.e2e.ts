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
  const productRows = [
    {
      name: 'Single Smashed Patty',
      priceMinor: 12_000,
      categoryIndex: 1,
      family: 'TUX',
      isCombo: false,
      soldOut: false,
      description: '1 smashed patty, cheese, TUX sauce, tomatoes, pickles, lettuce',
    },
    {
      name: 'Double Smashed Patty',
      priceMinor: 16_000,
      categoryIndex: 1,
      family: 'TUX',
      isCombo: false,
      soldOut: false,
      description: '2 smashed patties, cheese, TUX sauce, tomatoes, pickles, lettuce',
    },
    {
      name: 'Triple Smashed Patty',
      priceMinor: 20_000,
      categoryIndex: 1,
      family: 'TUX',
      isCombo: false,
      soldOut: false,
      description: '3 smashed patties, cheese, TUX sauce, tomatoes, pickles, lettuce',
    },
    {
      name: 'TUX Quatro Smashed Patty',
      priceMinor: 25_000,
      categoryIndex: 1,
      family: 'TUX',
      isCombo: false,
      soldOut: true,
      description:
        '4 smashed patties, cheese sauce, TUX sauce, pickles, caramelized onions, mushroom',
    },
    {
      name: 'Single TUXIFY',
      priceMinor: 14_000,
      categoryIndex: 1,
      family: 'TUXIFY',
      isCombo: false,
      soldOut: false,
      description:
        'Brioche bun, burger beef, American cheese, pickles, chopped onion, ketchup, TUXIFY sauce',
    },
    {
      name: 'Double TUXIFY',
      priceMinor: 18_000,
      categoryIndex: 1,
      family: 'TUXIFY',
      isCombo: false,
      soldOut: false,
      description:
        'Brioche bun, 2 burger beef, American cheese, pickles, chopped onion, ketchup, TUXIFY sauce',
    },
    {
      name: 'Triple TUXIFY',
      priceMinor: 22_000,
      categoryIndex: 1,
      family: 'TUXIFY',
      isCombo: false,
      soldOut: false,
      description:
        'Brioche bun, 3 burger beef, American cheese, pickles, chopped onion, ketchup, TUXIFY sauce',
    },
    {
      name: 'Quatro TUXIFY',
      priceMinor: 26_000,
      categoryIndex: 1,
      family: 'TUXIFY',
      isCombo: false,
      soldOut: false,
      description:
        'Brioche bun, 4 burger beef, American cheese, pickles, chopped onion, ketchup, TUXIFY sauce',
    },
    {
      name: 'Johnny’s',
      priceMinor: 33_000,
      categoryIndex: 1,
      family: null,
      isCombo: false,
      soldOut: false,
      description:
        '2 large smashed patties, 2 bacon, cheese sauce, caramelized onion, Johnny’s sauce. Served with potato wedges',
    },
    {
      name: 'Classic Fries',
      priceMinor: 3_000,
      categoryIndex: 3,
      family: null,
      isCombo: false,
      soldOut: false,
      description: null,
    },
    {
      name: 'Potato Wedges',
      priceMinor: 4_000,
      categoryIndex: 3,
      family: null,
      isCombo: false,
      soldOut: false,
      description: null,
    },
    {
      name: 'Chili Fries',
      priceMinor: 7_000,
      categoryIndex: 3,
      family: null,
      isCombo: false,
      soldOut: false,
      description: 'Fries, cheese, chili sauce, jalapeno',
    },
    {
      name: 'TUX Fries',
      priceMinor: 9_500,
      categoryIndex: 3,
      family: null,
      isCombo: false,
      soldOut: false,
      description: 'Fries, smashed patty, cheese, pickles, caramelized onions, jalapeno, TUX sauce',
    },
    {
      name: 'Doppy Fries',
      priceMinor: 12_500,
      categoryIndex: 3,
      family: null,
      isCombo: false,
      soldOut: false,
      description:
        'Fries, smashed patty, bacon, cheese, caramelized onions, ranch sauce, nachos, chopped green onion',
    },
    {
      name: 'Classic Hawawshi',
      priceMinor: 10_500,
      categoryIndex: 4,
      family: null,
      isCombo: false,
      soldOut: false,
      description: 'Baladi bread, hawawshi meat, onion, TUX Hawawshi sauce',
    },
    {
      name: 'TUX Hawawshi',
      priceMinor: 12_500,
      categoryIndex: 4,
      family: null,
      isCombo: false,
      soldOut: false,
      description: 'Baladi bread, hawawshi meat, onion, TUX Hawawshi sauce, mozzarella',
    },
    {
      name: 'Soda',
      priceMinor: 2_000,
      categoryIndex: 7,
      family: null,
      isCombo: false,
      soldOut: false,
      description: null,
    },
    {
      name: 'Water',
      priceMinor: 1_000,
      categoryIndex: 7,
      family: null,
      isCombo: false,
      soldOut: false,
      description: null,
    },
    {
      name: 'Combo Smash + Required Beverage',
      priceMinor: 19_000,
      categoryIndex: 2,
      family: null,
      isCombo: true,
      soldOut: false,
      description: null,
    },
  ] as const;
  const products = productRows.map((item, index) => ({
    id: product(index + 1),
    shopId: SHOP,
    categoryId: category(item.categoryIndex),
    name: item.name,
    description: item.description,
    priceMinor: item.priceMinor,
    imageKey: null,
    active: true,
    soldOut: item.soldOut,
    family: item.family,
    isCombo: item.isCombo,
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
        { id: category(2), shopId: SHOP, name: 'Combo', sortOrder: 1, active: true },
        { id: category(3), shopId: SHOP, name: 'Fries', sortOrder: 2, active: true },
        { id: category(4), shopId: SHOP, name: 'Hawawshi', sortOrder: 3, active: true },
        { id: category(5), shopId: SHOP, name: 'Zalabia', sortOrder: 4, active: true },
        { id: category(6), shopId: SHOP, name: 'Extras', sortOrder: 5, active: true },
        { id: category(7), shopId: SHOP, name: 'Drinks', sortOrder: 6, active: true },
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
      comboBeverageOptions: [17, 18].map((beverageIndex, sortOrder) => ({
        shopId: SHOP,
        comboProductId: product(19),
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
          inventoryItemId: inventory(1),
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

async function waitForDndKeyboardSensor(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      }),
  );
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
  const card = page.locator('.product-card').filter({ hasText: 'Single Smashed Patty' }).first();
  await card.getByRole('button', { name: 'Extra', exact: true }).click();
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
  await page.getByRole('button', { name: 'Add one Double Smashed Patty' }).click();
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
  await page
    .getByLabel('Menu categories')
    .getByRole('button', { name: 'Combo', exact: true })
    .click();
  await page.getByRole('button', { name: 'Add one Combo Smash + Required Beverage' }).click();
  const customizer = page.getByRole('dialog', { name: 'Combo Smash + Required Beverage' });
  await customizer.getByRole('combobox').selectOption({ label: 'Soda' });
  await customizer.getByRole('button', { name: 'Add to order' }).click();
  await openCartIfMobile(page, testInfo);
  const cart = currentOrderCart(page, testInfo);
  await cart.getByRole('button', { name: 'Split payment' }).click();
  await cart.getByLabel('Amount A').fill('50');
  await cart.getByLabel('Amount A').blur();
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
  await page.waitForFunction(
    () =>
      document.querySelector('.welcome-action') !== null ||
      document.querySelector('[aria-label="Operations"]') !== null,
  );
  const welcomeAction = page.locator('.welcome-action');
  if (await welcomeAction.isVisible().catch(() => false)) await welcomeAction.click();
  await waitForActiveShell(page);
  await expect(page.getByRole('img', { name: 'TUX' }).first()).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Add one TUX Quatro Smashed Patty' }),
  ).toBeDisabled();
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
  await searchInput.fill('soda');
  await expect(page.getByRole('button', { name: 'Add one Soda' })).toBeVisible();

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

test('unified menu edit persists one combined worker layout with keyboard and rollback', async ({
  page,
}, testInfo) => {
  await enterActiveOrdersForCategoryTests(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  const editButton = page.getByRole('button', { name: 'Edit menu' });
  await expect(editButton).toBeVisible();
  await expect(page.getByRole('button', { name: 'Manage order' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit categories' })).toHaveCount(0);

  await editButton.click();
  await expect(editButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Search menu' })).toBeHidden();
  await expect(page.getByRole('group', { name: 'Product families' })).toBeHidden();
  await expect(page.getByRole('group', { name: 'Category alignment' })).toBeVisible();
  await expect(page.getByLabel('Menu edit actions')).toBeVisible();

  const categories = page.getByLabel('Menu categories').locator('.category-tab');
  await expect(categories).toHaveCount(7);
  await expect(categories.nth(0)).toHaveText('Burgers');
  await expect(categories.nth(1)).toHaveText('Combo');

  const burgers = page.getByLabel('Menu categories').getByRole('button', {
    name: 'Burgers',
    exact: true,
  });
  await burgers.focus();
  await page.keyboard.press('Space');
  await expect(burgers).toHaveClass(/category-tab-grabbed/);
  await expect(
    page.locator('.menu-pane .sr-only').filter({ hasText: 'Burgers picked up' }),
  ).toContainText('Burgers picked up');
  await waitForDndKeyboardSensor(page);
  await page.keyboard.press('ArrowRight');
  await expect(categories.nth(0)).toHaveText('Combo');
  await page.keyboard.press('Escape');
  await expect(categories.nth(0)).toHaveText('Burgers');

  await burgers.focus();
  await page.keyboard.press('Space');
  await expect(burgers).toHaveClass(/category-tab-grabbed/);
  await waitForDndKeyboardSensor(page);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  await expect(categories.nth(0)).toHaveText('Combo');
  await expect(categories.nth(1)).toHaveText('Burgers');

  await page.getByRole('button', { name: 'Right', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Right', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  let reorderCards = page.locator('.menu-edit-product-card');
  await expect(reorderCards).toHaveCount(9);
  await expect(reorderCards.nth(0)).toContainText('Single Smashed Patty');
  await expect(reorderCards.nth(1)).toContainText('Double Smashed Patty');
  const moveProductBeforeKey =
    testInfo.project.name === 'mobile-browser-fallback' ? 'ArrowUp' : 'ArrowLeft';
  const moveProductAfterKey =
    testInfo.project.name === 'mobile-browser-fallback' ? 'ArrowDown' : 'ArrowRight';

  await reorderCards.nth(1).focus();
  await page.keyboard.press('Space');
  await expect(reorderCards.nth(1)).toHaveClass(/menu-edit-product-card-grabbed/);
  await waitForDndKeyboardSensor(page);
  await page.keyboard.press(moveProductBeforeKey);
  await expect(reorderCards.nth(0)).toContainText('Double Smashed Patty');
  await page.keyboard.press('Escape');
  reorderCards = page.locator('.menu-edit-product-card');
  await expect(reorderCards.nth(0)).toContainText('Single Smashed Patty');

  await reorderCards.nth(1).focus();
  await page.keyboard.press('Space');
  await expect(reorderCards.nth(1)).toHaveClass(/menu-edit-product-card-grabbed/);
  await waitForDndKeyboardSensor(page);
  await page.keyboard.press(moveProductBeforeKey);
  await page.keyboard.press('Space');
  await expect(reorderCards.nth(0)).toContainText('Double Smashed Patty');

  expect(
    await categories.nth(0).evaluate((node) => getComputedStyle(node).animationName),
  ).toContain('menu-edit-jiggle');
  expect(
    await reorderCards.nth(0).evaluate((node) => getComputedStyle(node).animationName),
  ).toContain('menu-edit-jiggle');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await categories.nth(0).evaluate((node) => getComputedStyle(node).animationName)).toBe(
    'none',
  );
  expect(await reorderCards.nth(0).evaluate((node) => getComputedStyle(node).animationName)).toBe(
    'none',
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath('unified-menu-edit.png'),
    animations: 'disabled',
    caret: 'hide',
    fullPage: false,
  });

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Menu layout saved' })).toBeVisible();

  let persistedCategories = page.getByLabel('Menu categories').locator('.category-tab');
  await expect(persistedCategories.nth(0)).toHaveText('Combo');
  await expect(persistedCategories.nth(1)).toHaveText('Burgers');
  await expect(page.getByLabel('Menu categories')).toHaveAttribute('data-alignment', 'right');
  let menuCards = page.locator('.product-grid .product-card');
  await expect(menuCards.nth(0)).toContainText('Double Smashed Patty');

  await page.reload();
  await waitForActiveShell(page);
  persistedCategories = page.getByLabel('Menu categories').locator('.category-tab');
  await expect(persistedCategories.nth(0)).toHaveText('Combo');
  await expect(persistedCategories.nth(1)).toHaveText('Burgers');
  await expect(page.getByLabel('Menu categories')).toHaveAttribute('data-alignment', 'right');
  menuCards = page.locator('.product-grid .product-card');
  await expect(menuCards.nth(0)).toContainText('Double Smashed Patty');

  await page.getByRole('button', { name: 'Edit menu' }).click();
  reorderCards = page.locator('.menu-edit-product-card');
  await reorderCards.nth(0).focus();
  await page.keyboard.press('Space');
  await expect(reorderCards.nth(0)).toHaveClass(/menu-edit-product-card-grabbed/);
  await waitForDndKeyboardSensor(page);
  await page.keyboard.press(moveProductAfterKey);
  await page.keyboard.press('Space');
  await expect(reorderCards.nth(0)).toContainText('Single Smashed Patty');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  menuCards = page.locator('.product-grid .product-card');
  await expect(menuCards.nth(0)).toContainText('Double Smashed Patty');

  await page.getByRole('button', { name: 'Edit menu' }).click();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const resetCategories = page.getByLabel('Menu categories').locator('.category-tab');
  await expect(resetCategories.nth(0)).toHaveText('Burgers');
  await expect(page.getByLabel('Menu categories')).toHaveAttribute('data-alignment', 'left');
  menuCards = page.locator('.product-grid .product-card');
  await expect(menuCards.nth(0)).toContainText('Single Smashed Patty');
});

test('unified menu edit persistence failure keeps the draft and order intact', async ({
  page,
}, testInfo) => {
  await enterActiveOrdersForCategoryTests(page);

  await page.getByRole('button', { name: 'Add one Single Smashed Patty' }).click();
  await openCartIfMobile(page, testInfo);
  const cart = currentOrderCart(page, testInfo);
  await expect(cart).toContainText('Single Smashed Patty');
  await closeMobileCartIfOpen(page, testInfo);

  const editButton = page.getByRole('button', { name: 'Edit menu' });
  await editButton.click();
  await page.getByRole('button', { name: 'Right', exact: true }).click();

  await page.evaluate(() => {
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function forcedPreferenceWriteFailure(
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (this.name === 'workerMenuLayouts') {
        throw new DOMException('Forced preference write failure', 'AbortError');
      }
      return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
    };
  });

  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.getByRole('alert')).toHaveText('Could not save menu layout. Try again.');
  await expect(editButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Menu edit actions')).toBeVisible();
  await openCartIfMobile(page, testInfo);
  await expect(currentOrderCart(page, testInfo)).toContainText('Single Smashed Patty');
});

test('unified menu edit exposes no isolated product-order editor', async ({ page }) => {
  await enterActiveOrdersForCategoryTests(page);
  await expect(page.getByRole('button', { name: 'Manage order' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit menu' }).click();
  await expect(page.getByRole('heading', { name: /Reordering Burgers/ })).toHaveCount(0);
  await expect(page.locator('.product-position-editor')).toHaveCount(0);
  await expect(page.locator('.menu-edit-product-card')).toHaveCount(9);
  await expect(page.getByLabel('Menu edit actions')).toBeVisible();
});

test('Extra shortcuts preserve customized pricing and fresh adds', async ({ page }, testInfo) => {
  await enterActiveOrdersForCategoryTests(page);

  const classicCard = page
    .locator('.product-card')
    .filter({ hasText: 'Single Smashed Patty' })
    .first();
  const doubleCard = page
    .locator('.product-card')
    .filter({ hasText: 'Double Smashed Patty' })
    .first();
  await expect(classicCard.getByRole('button', { name: 'Extra', exact: true })).toBeVisible();
  await expect(doubleCard.getByRole('button', { name: 'Extra', exact: true })).toBeVisible();

  await classicCard.getByRole('button', { name: 'Extra', exact: true }).click();
  const addDialog = page.getByRole('dialog', { name: 'Single Smashed Patty' });
  const addExtrasSection = addDialog.locator('[aria-labelledby="extras-title"]');
  await expect(addExtrasSection).toBeFocused();
  await addDialog.getByRole('button', { name: 'Add one Extra Cheese' }).click();
  await addDialog.getByRole('button', { name: 'Add one Extra Cheese' }).click();
  await addDialog.getByRole('button', { name: 'Add one Extra Patty' }).click();
  await addDialog.getByRole('button', { name: 'Add to order' }).click();

  await expect(classicCard.locator('.product-quantity-badge')).toHaveText('1');
  await openCartIfMobile(page, testInfo);
  const cart = currentOrderCart(page, testInfo);
  const classicLines = cart.locator('.cart-line').filter({ hasText: 'Single Smashed Patty' });
  await expect(classicLines).toHaveCount(1);
  await expect(classicLines.nth(0)).toContainText('2× Extra Cheese');
  await expect(classicLines.nth(0)).toContainText('1× Extra Patty');
  await expect(classicLines.nth(0)).toContainText(/200\.00/);

  await closeMobileCartIfOpen(page, testInfo);
  await classicCard.getByRole('button', { name: 'Add one Single Smashed Patty' }).click();
  await expect(classicCard.locator('.product-quantity-badge')).toHaveText('2');
  await openCartIfMobile(page, testInfo);
  await expect(classicLines).toHaveCount(2);
  await expect(classicLines.nth(1)).not.toContainText('Extra Cheese');
  await expect(classicLines.nth(1)).not.toContainText('Extra Patty');
  await expect(classicLines.nth(1)).toContainText(/120\.00/);

  await classicLines.nth(0).getByRole('button', { name: 'Extra', exact: true }).click();
  const editDialog = page.getByRole('dialog', { name: 'Single Smashed Patty' });
  await expect(editDialog.locator('[aria-labelledby="extras-title"]')).toBeFocused();
  await editDialog.getByRole('button', { name: 'Add one Extra Patty' }).click();
  await editDialog.getByRole('button', { name: 'Save item' }).click();

  const updatedLines = cart.locator('.cart-line').filter({ hasText: 'Single Smashed Patty' });
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

  const lines = cart.locator('.cart-line').filter({ hasText: 'Single Smashed Patty' });
  await expect(lines).toHaveCount(1);
  const line = lines.first();
  await expect(line).toContainText('1× Extra Cheese');
  await expect(line.getByRole('button', { name: /Decrease .* quantity/ })).toBeVisible();
  await expect(line.getByRole('button', { name: /Increase .* quantity/ })).toBeVisible();
  await expect(line.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await expect(line.getByRole('button', { name: 'Extra', exact: true })).toBeVisible();

  await line.getByRole('button', { name: /Increase .* quantity/ }).click();
  await expect(lines).toHaveCount(1);
  await expect(lines.first()).toContainText('× 2');
  await expect(lines.first()).toContainText('1× Extra Cheese');

  await lines
    .first()
    .getByRole('button', { name: /Decrease .* quantity/ })
    .click();
  await expect(lines.first()).toContainText('× 1');
  await expect(page.locator('.undo-toast')).toContainText('Removed one Single Smashed Patty');

  await lines.first().getByRole('button', { name: 'Edit', exact: true }).click();
  const editDialog = page.getByRole('dialog', { name: 'Single Smashed Patty' });
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

test('cash entry stays optional and split stays allocation-only', async ({ page }, testInfo) => {
  await enterActiveOrdersForCategoryTests(page);

  await page.getByRole('button', { name: 'Add one Double Smashed Patty' }).click();
  await openCartIfMobile(page, testInfo);
  let cart = currentOrderCart(page, testInfo);

  await cart.locator('.adjustment-disclosure').filter({ hasText: 'Discount' }).click();
  await cart.getByRole('textbox', { name: 'Discount' }).fill('39');
  await cart.getByRole('textbox', { name: 'Discount' }).blur();
  await expect(cart.locator('.grand-total')).toContainText('121.00');

  await cart.getByRole('button', { name: 'Cash', exact: true }).click();
  const cashReceived = cart.getByLabel('Cash received');
  await expect(cashReceived).toHaveValue('');
  await expect(cashReceived).toHaveAttribute('placeholder', '0');

  const tenders = cart.getByLabel('Smart Cash tenders').getByRole('button');
  await expect(tenders).toHaveCount(5);
  await expect(tenders.nth(0)).toContainText('121.00');
  await expect(tenders.nth(4)).toContainText('200.00');

  await cashReceived.fill('');
  await cashReceived.blur();
  await expect(cashReceived).toHaveValue('');
  await cart.getByRole('button', { name: 'Place Order' }).click();
  await expectOrderPlaced(page);
  await closeMobileCartIfOpen(page, testInfo);

  await page.getByRole('button', { name: 'Add one Triple Smashed Patty' }).click();
  await page.getByRole('button', { name: 'Add one Triple Smashed Patty' }).click();
  await openCartIfMobile(page, testInfo);
  cart = currentOrderCart(page, testInfo);

  await cart.getByRole('button', { name: 'Split payment' }).click();
  await cart.getByLabel('Amount A').fill('320');
  await cart.getByLabel('Amount A').blur();
  await expect(cart.locator('.split-remainder')).toContainText('80.00');
  await expect(cart.getByLabel('Cash received A')).toHaveCount(0);
  await expect(cart.getByLabel('Cash received B')).toHaveCount(0);

  await cart.getByRole('button', { name: 'Place Order' }).click();
  await expectOrderPlaced(page);
});

test('resize Current Order rail persists device-local width', async ({ page }, testInfo) => {
  await enterActiveOrdersForCategoryTests(page);

  const separator = page.getByRole('separator', { name: 'Resize Current Order' });
  if (!testInfo.project.name.startsWith('desktop')) {
    await expect(separator).toHaveCount(0);
    return;
  }

  await expect(separator).toBeVisible();
  await expect(separator).toHaveAttribute('aria-orientation', 'vertical');

  const cart = page.locator('.desktop-cart-wrap');
  const menu = page.locator('.menu-pane');
  const initialCart = await cart.boundingBox();
  const initialMenu = await menu.boundingBox();
  expect(initialCart).not.toBeNull();
  expect(initialMenu).not.toBeNull();
  expect(Math.abs(initialCart!.width - 432)).toBeLessThanOrEqual(2);

  await separator.focus();
  await page.keyboard.press('ArrowLeft');
  await expect
    .poll(async () => (await cart.boundingBox())?.width ?? 0)
    .toBeGreaterThan(initialCart!.width);
  const keyboardCart = await cart.boundingBox();
  const keyboardMenu = await menu.boundingBox();
  expect(keyboardCart).not.toBeNull();
  expect(keyboardMenu).not.toBeNull();
  expect(keyboardMenu!.width).toBeLessThan(initialMenu!.width);

  const handleBox = await separator.boundingBox();
  expect(handleBox).not.toBeNull();
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox!.x - 48, handleBox!.y + handleBox!.height / 2, { steps: 4 });
  await page.mouse.up();

  const resizedCart = await cart.boundingBox();
  expect(resizedCart).not.toBeNull();
  expect(resizedCart!.width).toBeGreaterThan(keyboardCart!.width);
  expect(resizedCart!.width).toBeLessThanOrEqual(600);
  await expectNoHorizontalOverflow(page);

  const persisted = await page.evaluate(() =>
    localStorage.getItem('tux.operations.currentOrderWidth'),
  );
  expect(persisted).not.toBeNull();
  expect(Number(persisted)).toBeCloseTo(resizedCart!.width, 0);

  await page.reload();
  await waitForActiveShell(page);
  const reloadedCart = page.locator('.desktop-cart-wrap');
  await expect
    .poll(async () => (await reloadedCart.boundingBox())?.width ?? 0)
    .toBeCloseTo(Number(persisted), 0);

  await page.setViewportSize({ width: 1000, height: 960 });
  await expect.poll(async () => (await reloadedCart.boundingBox())?.width ?? 0).toBeCloseTo(450, 0);
  await expectNoHorizontalOverflow(page);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('tux.operations.currentOrderWidth')))
    .toBe('450');
});

test('premium POS visual hierarchy matches approved sizing', async ({ page }, testInfo) => {
  await enterActiveOrdersForCategoryTests(page);
  await expectNoHorizontalOverflow(page);

  if (!testInfo.project.name.startsWith('desktop')) return;

  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const nav = page.getByRole('navigation', { name: 'Operations' });
  const navBox = await nav.boundingBox();
  expect(navBox).not.toBeNull();
  expect(Math.abs(navBox!.x + navBox!.width / 2 - viewport!.width / 2)).toBeLessThanOrEqual(2);

  const activeNav = page.getByRole('button', { name: 'Orders', exact: true });
  const inactiveNav = page.getByRole('button', { name: 'Orders Board', exact: true });
  const activeNavStyle = await activeNav.evaluate((node) => getComputedStyle(node));
  const inactiveNavStyle = await inactiveNav.evaluate((node) => getComputedStyle(node));
  expect(activeNavStyle.fontSize).toBe('15px');
  expect(activeNavStyle.lineHeight).toBe('20px');
  expect(Number(activeNavStyle.fontWeight)).toBe(600);
  expect(inactiveNavStyle.fontSize).toBe('15px');
  expect(inactiveNavStyle.lineHeight).toBe('20px');
  expect(Number(inactiveNavStyle.fontWeight)).toBe(500);
  expect((await activeNav.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  const categories = page.getByLabel('Menu categories');
  const activeCategory = categories.getByRole('button', { name: 'Burgers', exact: true });
  const inactiveCategory = categories.getByRole('button', { name: 'Combo', exact: true });
  const activeCategoryStyle = await activeCategory.evaluate((node) => getComputedStyle(node));
  const inactiveCategoryStyle = await inactiveCategory.evaluate((node) => getComputedStyle(node));
  expect(activeCategoryStyle.fontSize).toBe('15px');
  expect(activeCategoryStyle.lineHeight).toBe('20px');
  expect(Number(activeCategoryStyle.fontWeight)).toBe(600);
  expect(Number(inactiveCategoryStyle.fontWeight)).toBe(500);
  expect((await activeCategory.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  const stressCard = page.locator('.product-card').filter({ hasText: 'Johnny’s' }).first();
  const productName = stressCard.locator('.product-copy strong');
  const productNameStyle = await productName.evaluate((node) => getComputedStyle(node));
  expect(productNameStyle.fontSize).toBe('15px');
  expect(productNameStyle.lineHeight).toBe('20px');
  expect(Number(productNameStyle.fontWeight)).toBe(600);
  await expect(stressCard.locator('.product-copy p')).toHaveCount(0);
  expect(
    (await stressCard.locator('.product-price').evaluate((node) => getComputedStyle(node)))
      .fontVariantNumeric,
  ).toContain('tabular-nums');

  await page.getByRole('button', { name: 'Add one Single Smashed Patty' }).click();
  const cart = page.locator('.desktop-cart-wrap').getByRole('complementary', {
    name: 'Current order',
  });
  const cartTitleStyle = await cart
    .locator('.cart-title')
    .evaluate((node) => getComputedStyle(node));
  expect(cartTitleStyle.fontSize).toBe('17px');
  expect(cartTitleStyle.lineHeight).toBe('22px');
  expect(Number(cartTitleStyle.fontWeight)).toBe(600);

  const subsectionHeadingStyle = await cart
    .locator('.payment-section h2')
    .evaluate((node) => getComputedStyle(node));
  expect(subsectionHeadingStyle.fontSize).toBe('14px');
  expect(subsectionHeadingStyle.lineHeight).toBe('18px');
  expect(Number(subsectionHeadingStyle.fontWeight)).toBe(600);

  const lineNameStyle = await cart
    .locator('.cart-line-top strong')
    .first()
    .evaluate((node) => getComputedStyle(node));
  expect(lineNameStyle.fontSize).toBe('15px');
  expect(lineNameStyle.lineHeight).toBe('20px');
  expect(Number(lineNameStyle.fontWeight)).toBe(600);

  await cart.getByRole('button', { name: 'Cash', exact: true }).click();
  const cashInputStyle = await cart
    .getByLabel('Cash received')
    .evaluate((node) => getComputedStyle(node));
  expect(cashInputStyle.fontSize).toBe('14px');
  expect(cashInputStyle.lineHeight).toBe('18px');
  expect(Number(cashInputStyle.fontWeight)).toBe(400);
  expect(cashInputStyle.fontVariantNumeric).toContain('tabular-nums');

  const totalLabelStyle = await cart
    .locator('.grand-total dt')
    .evaluate((node) => getComputedStyle(node));
  expect(totalLabelStyle.fontSize).toBe('18px');
  expect(totalLabelStyle.lineHeight).toBe('22px');
  expect(Number(totalLabelStyle.fontWeight)).toBe(600);

  const totalStyle = await cart
    .locator('.grand-total dd')
    .evaluate((node) => getComputedStyle(node));
  expect(totalStyle.fontSize).toBe('22px');
  expect(totalStyle.lineHeight).toBe('26px');
  expect(Number(totalStyle.fontWeight)).toBe(700);
  expect(totalStyle.fontVariantNumeric).toContain('tabular-nums');

  const placeOrder = cart.getByRole('button', { name: 'Place Order' });
  const placeOrderBox = await placeOrder.boundingBox();
  const placeOrderStyle = await placeOrder.evaluate((node) => getComputedStyle(node));
  expect(placeOrderBox).not.toBeNull();
  expect(placeOrderBox!.height).toBeGreaterThanOrEqual(48);
  expect(placeOrderStyle.fontSize).toBe('16px');
  expect(placeOrderStyle.lineHeight).toBe('20px');
  expect(Number(placeOrderStyle.fontWeight)).toBe(600);
});

test('visual approval evidence covers approved POS states', async ({ page }, testInfo) => {
  async function screenshot(name: string): Promise<void> {
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(name),
      animations: 'disabled',
      caret: 'hide',
      fullPage: false,
    });
  }

  async function startFresh(keepWelcome = false): Promise<void> {
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
    if (keepWelcome) {
      await expect(welcomeAction).toBeVisible();
      return;
    }
    if (await welcomeAction.isVisible().catch(() => false)) await welcomeAction.click();
    await waitForActiveShell(page);
  }

  await startFresh(true);
  if (testInfo.project.name === 'desktop-browser-fallback') {
    await screenshot('01-welcome.png');
  }
  await page.locator('.welcome-action').click();
  await waitForActiveShell(page);
  await expectNoHorizontalOverflow(page);

  if (testInfo.project.name === 'desktop-browser-fallback') {
    await screenshot('02-default-orders.png');
    await captureVisualEvidence(page, testInfo);

    const navigation = page.getByRole('navigation', { name: 'Operations' });
    const navigationBox = await navigation.boundingBox();
    const viewport = page.viewportSize();
    expect(navigationBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(
      Math.abs(navigationBox!.x + navigationBox!.width / 2 - viewport!.width / 2),
    ).toBeLessThanOrEqual(2);

    await page.keyboard.press('Control+K');
    const searchInput = page.getByPlaceholder('Search products');
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toBeFocused();
    await screenshot('03-expanded-search.png');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Edit menu' }).click();
    await expect(page.getByLabel('Menu edit actions')).toBeVisible();
    await expect(page.locator('.menu-edit-product-card').first()).toBeVisible();
    await screenshot('04-unified-menu-edit.png');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    await page.getByRole('button', { name: 'Add one Triple Smashed Patty' }).click();
    await page.getByRole('button', { name: 'Add one Triple Smashed Patty' }).click();
    await page.getByRole('button', { name: 'Add one Triple TUXIFY' }).click();
    await page.getByRole('button', { name: 'Add one Double Smashed Patty' }).click();
    await page.getByLabel('Menu categories').getByRole('button', { name: 'Drinks' }).click();
    await page.getByRole('button', { name: 'Add one Soda' }).click();

    let cart = page.locator('.desktop-cart-wrap').getByRole('complementary', {
      name: 'Current order',
    });
    await cart.locator('.adjustment-disclosure').filter({ hasText: 'Discount' }).click();
    await cart.getByRole('textbox', { name: 'Discount' }).fill('95');
    await cart.getByRole('textbox', { name: 'Discount' }).blur();
    await expect(cart.locator('.grand-total')).toContainText('705.00');
    await cart.getByRole('button', { name: 'Cash', exact: true }).click();
    const tenders = cart.getByLabel('Smart Cash tenders').getByRole('button');
    await expect(tenders).toHaveCount(5);
    await expect(tenders.nth(0)).toContainText('705.00');
    await expect(tenders.nth(1)).toContainText('710.00');
    await expect(tenders.nth(2)).toContainText('720.00');
    await expect(tenders.nth(3)).toContainText('750.00');
    await expect(tenders.nth(4)).toContainText('800.00');
    const cashReceived = cart.getByLabel('Cash received');
    await expect(cashReceived).toHaveValue('');
    await screenshot('05-single-cash-705.png');
    await cashReceived.fill('800');
    await cashReceived.blur();
    await expect(cart.locator('.payment-summary')).toContainText('Change: EGP 95.00');

    await startFresh();
    await page.getByRole('button', { name: 'Add one Triple Smashed Patty' }).click();
    await page.getByRole('button', { name: 'Add one Triple Smashed Patty' }).click();
    cart = page.locator('.desktop-cart-wrap').getByRole('complementary', {
      name: 'Current order',
    });
    await cart.getByRole('button', { name: 'Split payment' }).click();
    await cart.getByLabel('Amount A').fill('320');
    await cart.getByLabel('Amount A').blur();
    await expect(cart.locator('.split-remainder')).toContainText('80.00');
    await expect(cart.getByLabel('Cash received A')).toHaveCount(0);
    await expect(cart.getByLabel('Cash received B')).toHaveCount(0);
    await screenshot('06-split-payment-400.png');

    await startFresh();
    const classicCard = page
      .locator('.product-card')
      .filter({ hasText: 'Single Smashed Patty' })
      .first();
    await classicCard.getByRole('button', { name: 'Extra', exact: true }).click();
    const extrasDialog = page.getByRole('dialog', { name: 'Single Smashed Patty' });
    await extrasDialog.getByRole('button', { name: 'Add one Extra Cheese' }).click();
    await extrasDialog.getByRole('button', { name: 'Add one Extra Patty' }).click();
    await screenshot('07-extras-customizer.png');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const transitionDurations = await page
      .locator('.product-card')
      .first()
      .evaluate((node) =>
        getComputedStyle(node)
          .transitionDuration.split(',')
          .map((value) => parseFloat(value)),
      );
    expect(transitionDurations.every((duration) => duration <= 0.001)).toBe(true);
    return;
  }

  await page.getByRole('button', { name: 'Add one Single Smashed Patty' }).click();
  await openCartIfMobile(page, testInfo);
  await expect(page.locator('.mobile-cart-overlay')).toBeVisible();
  if (testInfo.project.name === 'mobile-browser-fallback') {
    await screenshot('08-mobile-review-pay.png');
  } else {
    await screenshot('09-tablet-review-pay.png');
  }
});

test('final correction keeps header and categories visible during compact search', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');
  await enterActiveOrdersForCategoryTests(page);
  const header = page.locator('.operations-header');
  const headerBox = await header.boundingBox();
  const headerStyle = await header.evaluate((node) => getComputedStyle(node));
  expect(headerBox).not.toBeNull();
  expect(Math.round(headerBox!.height)).toBe(64);
  expect(headerStyle.paddingLeft).toBe('16px');
  expect(headerStyle.paddingRight).toBe('16px');
  const logoBox = await header.getByRole('img', { name: 'TUX' }).boundingBox();
  expect(logoBox).not.toBeNull();
  expect(Math.round(logoBox!.height)).toBe(44);
  const categories = page.getByLabel('Menu categories');
  await expect(categories).toHaveAttribute('data-alignment', 'left');
  expect((await categories.evaluate((node) => getComputedStyle(node))).gap).toBe('6px');
  const toolbarBox = await page.locator('.menu-toolbar').boundingBox();
  expect(toolbarBox).not.toBeNull();
  expect(toolbarBox!.height).toBeGreaterThan(56);
  const actionButtons = page.locator('.category-nav-actions > button');
  await expect(actionButtons).toHaveCount(2);
  await expect(actionButtons.nth(0)).toHaveAccessibleName('Edit menu');
  await expect(actionButtons.nth(1)).toHaveAccessibleName('Search menu');
  await page.getByRole('button', { name: 'Search menu' }).click();
  await expect(header).toBeVisible();
  await expect(categories).toBeVisible();
  const search = page.locator('.category-search-inline');
  const searchBox = await search.boundingBox();
  expect(searchBox).not.toBeNull();
  expect(Math.round(searchBox!.width)).toBe(300);
  await expect(search.locator('kbd')).toHaveCount(0);
  const input = page.getByPlaceholder('Search products');
  await expect(input).toBeFocused();
  const inputStyle = await input.evaluate((node) => getComputedStyle(node));
  expect(inputStyle.fontSize).toBe('14px');
  expect(inputStyle.lineHeight).toBe('18px');
  expect(Number(inputStyle.fontWeight)).toBe(400);
  const clear = search.getByRole('button', { name: 'Clear search' });
  await expect(clear).toHaveText('×');
  const clearBox = await clear.boundingBox();
  expect(clearBox).not.toBeNull();
  expect(Math.round(clearBox!.width)).toBe(44);
  expect(Math.round(clearBox!.height)).toBe(44);
});

test('final correction keeps product controls cashier-sized', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');
  await enterActiveOrdersForCategoryTests(page);
  const gridStyle = await page.locator('.product-grid').evaluate((node) => getComputedStyle(node));
  expect(gridStyle.rowGap).toBe('8px');
  expect(gridStyle.columnGap).toBe('8px');
  const card = page.locator('.product-card').filter({ hasText: 'Single Smashed Patty' }).first();
  expect((await card.evaluate((node) => getComputedStyle(node))).borderRadius).toBe('12px');
  const media = await card.locator('.product-media').boundingBox();
  expect(media).not.toBeNull();
  expect(Math.round(media!.width)).toBe(68);
  expect(Math.round(media!.height)).toBe(68);
  const price = await card.locator('.product-price').evaluate((node) => getComputedStyle(node));
  expect(price.fontSize).toBe('14px');
  expect(price.lineHeight).toBe('18px');
  expect(Number(price.fontWeight)).toBe(500);
  const extra = card.getByRole('button', { name: 'Extra', exact: true });
  expect(Math.round((await extra.boundingBox())!.height)).toBe(44);
  expect(Math.round((await extra.locator('svg').boundingBox())!.width)).toBe(20);
  const stepper = card.getByLabel('Single Smashed Patty quantity');
  for (const button of [
    stepper.getByRole('button', { name: 'Remove one Single Smashed Patty' }),
    stepper.getByRole('button', { name: 'Add one Single Smashed Patty' }),
  ]) {
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round(box!.width)).toBe(44);
    expect(Math.round(box!.height)).toBe(44);
  }
  await stepper.getByRole('button', { name: 'Add one Single Smashed Patty' }).click();
  const badge = card.locator('.product-quantity-badge');
  const badgeBox = await badge.boundingBox();
  expect(badgeBox).not.toBeNull();
  expect(badgeBox!.width).toBeGreaterThanOrEqual(24);
  expect(badgeBox!.height).toBeGreaterThanOrEqual(24);
  const badgeStyle = await badge.evaluate((node) => getComputedStyle(node));
  expect(badgeStyle.fontSize).toBe('13px');
  expect(badgeStyle.lineHeight).toBe('16px');
  expect(Number(badgeStyle.fontWeight)).toBe(600);
});

test('final correction keeps cart and payment controls at visible target sizes', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');
  await enterActiveOrdersForCategoryTests(page);
  const card = page.locator('.product-card').filter({ hasText: 'Single Smashed Patty' }).first();
  await card.getByRole('button', { name: 'Extra', exact: true }).click();
  const customizer = page.getByRole('dialog', { name: 'Single Smashed Patty' });
  await customizer.getByRole('button', { name: 'Add one Extra Cheese' }).click();
  await customizer.getByRole('button', { name: /Add to order/i }).click();
  const cart = page
    .locator('.desktop-cart-wrap')
    .getByRole('complementary', { name: 'Current order' });
  const clear = cart.getByRole('button', { name: 'Clear', exact: true });
  const clearStyle = await clear.evaluate((node) => getComputedStyle(node));
  expect(clearStyle.fontSize).toBe('14px');
  expect(clearStyle.lineHeight).toBe('18px');
  expect(Number(clearStyle.fontWeight)).toBe(500);
  const line = cart.locator('.cart-line').filter({ hasText: 'Single Smashed Patty' }).first();
  for (const name of [/Decrease .* quantity/, /Increase .* quantity/]) {
    const box = await line.getByRole('button', { name }).boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round(box!.width)).toBe(44);
    expect(Math.round(box!.height)).toBe(44);
  }
  for (const name of ['Edit', 'Extra']) {
    const button = line.getByRole('button', { name, exact: true });
    expect(Math.round((await button.boundingBox())!.height)).toBe(44);
    const style = await button.evaluate((node) => getComputedStyle(node));
    expect(style.fontSize).toBe('14px');
    expect(style.lineHeight).toBe('18px');
    expect(Number(style.fontWeight)).toBe(600);
  }
  expect(
    Math.round((await cart.getByRole('button', { name: 'Take Away' }).boundingBox())!.height),
  ).toBe(44);
  await cart.getByRole('button', { name: 'Cash', exact: true }).click();
  const cash = cart.getByLabel('Cash received');
  await expect(cash).toHaveValue('');
  await expect(cash).toHaveAttribute('placeholder', '0');
  expect(Math.round((await cash.boundingBox())!.height)).toBe(44);
  const tenders = cart.getByLabel('Smart Cash tenders');
  expect((await tenders.evaluate((node) => getComputedStyle(node))).gap).toBe('6px');
  expect(Math.round((await tenders.getByRole('button').first().boundingBox())!.height)).toBe(44);
  const split = cart.getByRole('button', { name: 'Split payment' });
  expect(Math.round((await split.boundingBox())!.height)).toBe(44);
  await split.click();
  await expect(cart.getByLabel('Method A')).toBeVisible();
  await expect(cart.getByLabel('Amount A')).toBeVisible();
  await expect(cart.getByLabel('Method B')).toBeVisible();
  await expect(cart.getByText('Amount B', { exact: true })).toBeVisible();
  await expect(cart.getByLabel('Cash received A')).toHaveCount(0);
  await expect(cart.getByLabel('Cash received B')).toHaveCount(0);
});

test('final correction resizes Current Order by 24px per keyboard step', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');
  await enterActiveOrdersForCategoryTests(page);
  const separator = page.getByRole('separator', { name: 'Resize Current Order' });
  const cart = page.locator('.desktop-cart-wrap');
  const before = await cart.boundingBox();
  expect(before).not.toBeNull();
  await separator.focus();
  await page.keyboard.press('ArrowRight');
  const after = await cart.boundingBox();
  expect(after).not.toBeNull();
  expect(Math.round(Math.abs(after!.width - before!.width))).toBe(24);
});

test('approved category hierarchy stays two-level across idle search and edit', async ({
  page,
}) => {
  await enterActiveOrdersForCategoryTests(page);

  const primary = page.getByLabel('Menu categories').locator('.category-tab');
  const expectedPrimary = ['Burgers', 'Combo', 'Fries', 'Hawawshi', 'Zalabia', 'Extras', 'Drinks'];
  await expect(primary).toHaveCount(expectedPrimary.length);
  for (const [index, name] of expectedPrimary.entries()) {
    await expect(primary.nth(index)).toHaveText(name);
  }
  await expect(primary.nth(0)).toHaveClass(/selected/);
  await expect(
    page.getByLabel('Menu categories').getByRole('button', { name: 'All', exact: true }),
  ).toHaveCount(0);

  const families = page.getByLabel('Product families').getByRole('button');
  await expect(families).toHaveCount(3);
  await expect(families.nth(0)).toHaveText('All');
  await expect(families.nth(1)).toHaveText('TUX');
  await expect(families.nth(2)).toHaveText('TUXIFY');
});

test('search keeps both category levels visible and hides edit chrome', async ({ page }) => {
  await enterActiveOrdersForCategoryTests(page);

  await page.getByRole('button', { name: 'Search menu' }).click();

  await expect(page.getByRole('navigation', { name: 'Operations' })).toBeVisible();
  await expect(page.getByLabel('Menu categories').locator('.category-tab')).toHaveCount(7);
  await expect(page.getByLabel('Product families')).toBeVisible();
  await expect(page.getByPlaceholder('Search products')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit menu' })).toBeHidden();
  await expect(page.getByText('Ctrl K', { exact: true })).toHaveCount(0);
  await expect(
    page.locator('.category-search-inline').getByRole('button', { name: 'Clear', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Clear search' })).toBeVisible();
});

test('unified menu edit keeps primary categories and Product Cards in place', async ({ page }) => {
  await enterActiveOrdersForCategoryTests(page);

  await page.getByRole('button', { name: 'Edit menu' }).click();

  await expect(page.getByPlaceholder('Search products')).toBeHidden();
  await expect(page.getByLabel('Product families')).toBeHidden();
  const primary = page.getByLabel('Menu categories').locator('.category-tab');
  const expectedPrimary = ['Burgers', 'Combo', 'Fries', 'Hawawshi', 'Zalabia', 'Extras', 'Drinks'];
  await expect(primary).toHaveCount(expectedPrimary.length);
  for (const [index, name] of expectedPrimary.entries()) {
    await expect(primary.nth(index)).toHaveText(name);
  }
  await expect(page.locator('.category-editor')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Category alignment' })).toBeVisible();
  await expect(page.locator('.menu-edit-product-card')).toHaveCount(9);
  await expect(page.getByLabel('Menu edit actions')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
});

test('final correction keeps Extra and product controls fully contained', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-browser-fallback');
  await enterActiveOrdersForCategoryTests(page);

  const grid = page.locator('.product-grid');
  const gridStyle = await grid.evaluate((node) => getComputedStyle(node));
  expect(gridStyle.rowGap).toBe('8px');
  expect(gridStyle.columnGap).toBe('8px');
  expect(gridStyle.alignItems).toBe('start');
  const columnCount = gridStyle.gridTemplateColumns.split(' ').filter(Boolean).length;
  expect(columnCount).toBeGreaterThanOrEqual(1);

  const card = grid.locator('.product-card').filter({ hasText: 'Single Smashed Patty' }).first();
  const cardBox = await card.boundingBox();
  expect(cardBox).not.toBeNull();

  const extra = card.getByRole('button', { name: 'Extra', exact: true });
  const minus = card.getByRole('button', { name: 'Remove one Single Smashed Patty' });
  const plus = card.getByRole('button', { name: 'Add one Single Smashed Patty' });
  const quantity = card.locator('.product-quantity output');
  await expect(extra).toBeVisible();
  await expect(minus).toBeVisible();
  await expect(quantity).toBeVisible();
  await expect(plus).toBeVisible();

  const controls = [extra, minus, quantity, plus];
  for (const control of controls) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(cardBox!.x - 1);
    expect(box!.y).toBeGreaterThanOrEqual(cardBox!.y - 1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(cardBox!.y + cardBox!.height + 1);
  }

  for (const button of [minus, plus]) {
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round(box!.width)).toBeGreaterThanOrEqual(44);
    expect(Math.round(box!.height)).toBeGreaterThanOrEqual(44);
  }
  const extraBox = await extra.boundingBox();
  expect(extraBox).not.toBeNull();
  expect(Math.round(extraBox!.height)).toBeGreaterThanOrEqual(44);

  const footerStyle = await card
    .locator('.product-card-footer')
    .evaluate((node) => getComputedStyle(node));
  expect(footerStyle.minHeight).toBe('52px');
  expect(footerStyle.display).toBe('grid');
  expect(footerStyle.rowGap).toBe('8px');
  const controlsStyle = await card
    .locator('.product-card-controls')
    .evaluate((node) => getComputedStyle(node));
  expect(controlsStyle.flexWrap).toBe('nowrap');

  await page.getByRole('button', { name: 'Fries', exact: true }).click();
  const plain = grid.locator('.product-card').filter({ hasText: 'Classic Fries' }).first();
  const described = grid.locator('.product-card').filter({ hasText: 'Chili Fries' }).first();
  await expect(plain.locator('.product-copy p')).toHaveCount(0);
  await expect(described.locator('.product-copy p')).toHaveCount(0);
  const plainStyle = await plain.evaluate((node) => getComputedStyle(node));
  const describedStyle = await described.evaluate((node) => getComputedStyle(node));
  expect(plainStyle.minHeight).toBe('0px');
  expect(describedStyle.minHeight).toBe('0px');

  const overflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.viewport);
});

test('final correction keeps mobile Review & pay unobstructed with integrated split', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-browser-fallback');
  await enterActiveOrdersForCategoryTests(page);
  await page.getByRole('button', { name: 'Add one Triple Smashed Patty' }).click();
  await page.getByRole('button', { name: 'Add one Triple Smashed Patty' }).click();

  await page.locator('.mobile-cart-trigger').click();
  const overlay = page.locator('.mobile-cart-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay.locator('.mobile-cart-bar strong')).toHaveText('Review & pay');
  await expect(overlay.locator('strong').filter({ hasText: /^Current order$/i })).toHaveCount(1);
  await expect(overlay.locator('.cart-title')).toHaveText('Current Order');
  await expect(page.getByRole('separator', { name: 'Resize Current Order' })).toHaveCount(0);

  const payment = overlay.locator('.payment-section');
  const methodsRow = payment.locator('.payment-methods-inline');
  const cash = methodsRow.getByRole('button', { name: 'Cash', exact: true });
  const instapay = methodsRow.getByRole('button', { name: 'Instapay', exact: true });
  const split = methodsRow.getByRole('button', { name: 'Split payment', exact: true });
  await expect(cash).toBeVisible();
  await expect(instapay).toBeVisible();
  await expect(split).toBeVisible();
  const [paymentBox, methodsRowBox, cashBox, instapayBox, splitBox] = await Promise.all([
    payment.boundingBox(),
    methodsRow.boundingBox(),
    cash.boundingBox(),
    instapay.boundingBox(),
    split.boundingBox(),
  ]);
  expect(paymentBox).not.toBeNull();
  expect(methodsRowBox).not.toBeNull();
  expect(cashBox).not.toBeNull();
  expect(instapayBox).not.toBeNull();
  expect(splitBox).not.toBeNull();
  const paymentPadding = await payment.evaluate((node) => {
    const style = getComputedStyle(node);
    return parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  });
  expect(Math.abs(methodsRowBox!.width - (paymentBox!.width - paymentPadding))).toBeLessThanOrEqual(
    2,
  );
  for (const box of [cashBox!, instapayBox!, splitBox!]) {
    expect(Math.round(box.height)).toBe(44);
  }
  const paymentTops = [cashBox!.y, instapayBox!.y, splitBox!.y];
  expect(Math.max(...paymentTops) - Math.min(...paymentTops)).toBeLessThanOrEqual(1);
  const paymentWidths = [cashBox!.width, instapayBox!.width, splitBox!.width];
  expect(Math.max(...paymentWidths) - Math.min(...paymentWidths)).toBeLessThanOrEqual(2);

  await split.click();
  await overlay.getByLabel('Amount A').fill('320');
  await overlay.getByLabel('Amount A').blur();
  await expect(overlay.getByText('Method A', { exact: true })).toBeVisible();
  await expect(overlay.getByText('Amount A', { exact: true })).toBeVisible();
  await expect(overlay.getByText('Method B', { exact: true })).toBeVisible();
  await expect(overlay.getByText('Amount B', { exact: true })).toBeVisible();
  await expect(overlay.locator('.split-remainder')).toContainText('80.00');
  await expect(overlay.getByText('Cash received', { exact: true })).toHaveCount(0);
  await expect(overlay.getByText('Change', { exact: true })).toHaveCount(0);

  const cancel = payment.getByRole('button', { name: 'Cancel split' });
  const cancelBox = await cancel.boundingBox();
  expect(cancelBox).not.toBeNull();
  expect(Math.round(cancelBox!.height)).toBe(44);
  expect(Math.abs(cancelBox!.width - (paymentBox!.width - paymentPadding))).toBeLessThanOrEqual(2);

  const scroll = overlay.locator('.cart-scroll');
  await scroll.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect(cancel).toBeVisible();
  const [finalControlBox, totalsBox, placeBox] = await Promise.all([
    cancel.boundingBox(),
    overlay.locator('.cart-totals').boundingBox(),
    overlay.getByRole('button', { name: 'Place Order' }).boundingBox(),
  ]);
  expect(finalControlBox).not.toBeNull();
  expect(totalsBox).not.toBeNull();
  expect(placeBox).not.toBeNull();
  expect(totalsBox!.y - (finalControlBox!.y + finalControlBox!.height)).toBeGreaterThanOrEqual(16);
  expect(placeBox!.y).toBeGreaterThanOrEqual(0);
  expect(placeBox!.y + placeBox!.height).toBeLessThanOrEqual(812);
});

test('final correction uses one Current Order separator', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');
  await enterActiveOrdersForCategoryTests(page);

  const separator = page.getByRole('separator', { name: 'Resize Current Order' });
  await expect(separator).toBeVisible();
  await expect(separator).toHaveAttribute('aria-orientation', 'vertical');

  const separatorLineWidth = await separator.evaluate(
    (node) => getComputedStyle(node, '::before').width,
  );
  expect(separatorLineWidth).toBe('1px');

  const cart = page.locator('.desktop-cart-wrap');
  const borderLeftWidth = await cart.evaluate((node) => getComputedStyle(node).borderLeftWidth);
  expect(borderLeftWidth).toBe('0px');

  const initial = await cart.boundingBox();
  expect(initial).not.toBeNull();
  await separator.focus();
  await page.keyboard.press('ArrowLeft');
  const resized = await cart.boundingBox();
  expect(resized).not.toBeNull();
  expect(Math.round(resized!.width - initial!.width)).toBe(24);
});

test('Burger family filter appears below main categories only for Burgers', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');
  await enterActiveOrdersForCategoryTests(page);
  const primary = page.getByLabel('Menu categories');
  await primary.getByRole('button', { name: 'Burgers', exact: true }).click();
  const families = page.getByLabel('Product families');
  await expect(families).toBeVisible();
  await expect(families.getByRole('button')).toHaveText(['All', 'TUX', 'TUXIFY']);
  await expect(primary.getByRole('button', { name: 'All', exact: true })).toHaveCount(0);
  const [primaryBox, familyBox] = await Promise.all([
    primary.boundingBox(),
    families.boundingBox(),
  ]);
  expect(primaryBox).not.toBeNull();
  expect(familyBox).not.toBeNull();
  expect(familyBox!.y).toBeGreaterThanOrEqual(primaryBox!.y + primaryBox!.height - 1);
  await primary.getByRole('button', { name: 'Fries', exact: true }).click();
  await expect(page.getByLabel('Product families')).toHaveCount(0);
});

test('product description appears only after opening the product card', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');
  await enterActiveOrdersForCategoryTests(page);
  const card = page.locator('.product-card').filter({ hasText: 'Single Smashed Patty' }).first();
  await expect(card.locator('.product-copy p')).toHaveCount(0);
  await card.getByRole('button', { name: 'Quick Info for Single Smashed Patty' }).click();
  const dialog = page.getByRole('dialog', { name: 'Single Smashed Patty' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.quick-info-body p')).toContainText('1 smashed patty');
});

test('Quick Info is informational only and has no Customize and add action', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');
  await enterActiveOrdersForCategoryTests(page);
  const card = page.locator('.product-card').filter({ hasText: 'Single Smashed Patty' }).first();
  await card.getByRole('button', { name: 'Quick Info for Single Smashed Patty' }).click();
  const dialog = page.getByRole('dialog', { name: 'Single Smashed Patty' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.quick-info-body p')).toContainText('1 smashed patty');
  await expect(dialog.getByRole('button', { name: 'Customize & add' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible();
});

test('requested compact product card controls do not overlap on 375px mobile', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-browser-fallback');
  await enterActiveOrdersForCategoryTests(page);
  const cards = page.locator('.product-card');
  const card = cards.filter({ hasText: 'Single Smashed Patty' }).first();
  const nextCard = cards.filter({ hasText: 'Double Smashed Patty' }).first();
  await expect(card.locator('.product-copy p')).toHaveCount(0);
  const price = card.locator('.product-price');
  const extra = card.getByRole('button', { name: 'Extra', exact: true });
  const quantity = card.locator('.product-quantity');
  const [cardBox, nextCardBox, priceBox, extraBox, quantityBox] = await Promise.all([
    card.boundingBox(),
    nextCard.boundingBox(),
    price.boundingBox(),
    extra.boundingBox(),
    quantity.boundingBox(),
  ]);
  expect(cardBox).not.toBeNull();
  expect(nextCardBox).not.toBeNull();
  for (const box of [priceBox, extraBox, quantityBox]) {
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(cardBox!.x - 1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(cardBox!.y + cardBox!.height + 1);
  }
  expect(nextCardBox!.y).toBeGreaterThanOrEqual(cardBox!.y + cardBox!.height + 7);
  await extra.click();
  await expect(page.locator('.product-customizer')).toBeVisible();
});

test('approved cards put 14px price top right and Extra bottom left on every product', async ({
  page,
}) => {
  await enterActiveOrdersForCategoryTests(page);

  for (const categoryName of ['Burgers', 'Combo', 'Fries', 'Hawawshi', 'Drinks']) {
    await page.getByRole('button', { name: categoryName, exact: true }).click();
    const cards = page.locator('.product-card');
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      await expect(
        cards.nth(index).getByRole('button', { name: 'Extra', exact: true }),
      ).toHaveCount(1);
    }
  }

  await page.getByRole('button', { name: 'Burgers', exact: true }).click();
  const card = page.locator('.product-card').filter({ hasText: 'Single Smashed Patty' }).first();
  const price = card.locator('.product-price');
  const extra = card.getByRole('button', { name: 'Extra', exact: true });
  const quantity = card.locator('.product-quantity');
  const [cardBox, priceBox, extraBox, quantityBox] = await Promise.all([
    card.boundingBox(),
    price.boundingBox(),
    extra.boundingBox(),
    quantity.boundingBox(),
  ]);
  expect(cardBox).not.toBeNull();
  expect(priceBox).not.toBeNull();
  expect(extraBox).not.toBeNull();
  expect(quantityBox).not.toBeNull();

  const priceFontSize = await price.evaluate((node) => getComputedStyle(node).fontSize);
  expect(priceFontSize).toBe('14px');
  expect(priceBox!.y).toBeLessThan(cardBox!.y + 36);
  expect(cardBox!.x + cardBox!.width - (priceBox!.x + priceBox!.width)).toBeLessThanOrEqual(16);
  expect(extraBox!.x - cardBox!.x).toBeLessThanOrEqual(16);
  expect(extraBox!.y).toBeGreaterThan(cardBox!.y + cardBox!.height / 2);
  expect(quantityBox!.x).toBeGreaterThan(extraBox!.x + extraBox!.width);
  expect(cardBox!.x + cardBox!.width - (quantityBox!.x + quantityBox!.width)).toBeLessThanOrEqual(
    16,
  );
  expect(
    Math.abs(extraBox!.y + extraBox!.height - (quantityBox!.y + quantityBox!.height)),
  ).toBeLessThanOrEqual(2);
});

test('product names stay fully readable while Current Order rail resizes', async ({
  page,
}, testInfo) => {
  await enterActiveOrdersForCategoryTests(page);
  if (!testInfo.project.name.startsWith('desktop')) return;

  const separator = page.getByRole('separator', { name: 'Resize Current Order' });
  const cart = page.locator('.desktop-cart-wrap');
  const menu = page.locator('.menu-pane');
  const grid = page.locator('.product-grid');

  async function expectReadableTitles(state: string): Promise<void> {
    const [cartBox, menuBox, firstCardBox, columns, titles] = await Promise.all([
      cart.boundingBox(),
      menu.boundingBox(),
      page.locator('.product-card').first().boundingBox(),
      grid.evaluate((node) => getComputedStyle(node).gridTemplateColumns),
      page.locator('.product-copy strong').evaluateAll((nodes) =>
        nodes.map((node) => {
          const element = node as HTMLElement;
          const range = document.createRange();
          range.selectNodeContents(element);
          const textRect = range.getBoundingClientRect();
          const box = element.getBoundingClientRect();
          return {
            text: element.textContent ?? '',
            clientHeight: element.clientHeight,
            scrollHeight: element.scrollHeight,
            textBottom: textRect.bottom,
            boxBottom: box.bottom,
          };
        }),
      ),
    ]);

    console.log(
      JSON.stringify({
        state,
        cartWidth: cartBox?.width ?? null,
        menuWidth: menuBox?.width ?? null,
        cardWidth: firstCardBox?.width ?? null,
        columns,
      }),
    );

    for (const title of titles) {
      expect(
        title.scrollHeight,
        `${state}: ${title.text} must not be line-clamped`,
      ).toBeLessThanOrEqual(title.clientHeight + 1);
      expect(
        title.textBottom,
        `${state}: ${title.text} must stay inside its title box`,
      ).toBeLessThanOrEqual(title.boxBottom + 1);
    }
  }

  await separator.focus();
  await page.keyboard.press('Home');
  await expect.poll(async () => (await cart.boundingBox())?.width ?? 0).toBeLessThanOrEqual(362);
  await expectReadableTitles('cart-min-360');

  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await cart.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(430);
  await expectReadableTitles('cart-default-432');

  await separator.focus();
  await page.keyboard.press('End');
  await expect.poll(async () => (await cart.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(598);
  await expectReadableTitles('cart-max-600');
});

test('long-term UI alignment contracts render correctly', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterActiveOrdersForCategoryTests(page);

  async function expectComposedMoneyInput(input: Locator): Promise<void> {
    const wrapper = input.locator('xpath=..');
    const [wrapperBox, inputStyles] = await Promise.all([
      wrapper.boundingBox(),
      input.evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          borderTopWidth: style.borderTopWidth,
          borderRightWidth: style.borderRightWidth,
          borderBottomWidth: style.borderBottomWidth,
          borderLeftWidth: style.borderLeftWidth,
          borderRadius: style.borderRadius,
          backgroundColor: style.backgroundColor,
          boxShadow: style.boxShadow,
        };
      }),
    ]);
    expect(wrapperBox).not.toBeNull();
    expect(wrapperBox!.height).toBeGreaterThanOrEqual(44);
    expect(inputStyles.borderTopWidth).toBe('0px');
    expect(inputStyles.borderRightWidth).toBe('0px');
    expect(inputStyles.borderBottomWidth).toBe('0px');
    expect(inputStyles.borderLeftWidth).toBe('0px');
    expect(inputStyles.borderRadius).toBe('0px');
    expect(inputStyles.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(inputStyles.boxShadow).toBe('none');

    await input.focus();
    await expect
      .poll(async () => wrapper.evaluate((node) => getComputedStyle(node).boxShadow))
      .not.toBe('none');
    await input.blur();
  }

  async function expectControlTopsAligned(controls: readonly Locator[]): Promise<void> {
    const boxes = await Promise.all(controls.map((control) => control.boundingBox()));
    for (const box of boxes) expect(box).not.toBeNull();
    const tops = boxes.map((box) => box!.y);
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);
  }

  await page.getByRole('button', { name: 'Add one Double Smashed Patty' }).click();
  const cart = currentOrderCart(page, testInfo);
  await cart.locator('.adjustment-disclosure').filter({ hasText: 'Discount' }).click();
  const discount = cart.getByRole('textbox', { name: 'Discount' });
  await expect(discount).toBeVisible();
  await expectComposedMoneyInput(discount);

  await cart.getByRole('button', { name: 'Cash', exact: true }).click();
  const cashReceived = cart.getByLabel('Cash received');
  await expect(cashReceived).toBeVisible();
  await expectComposedMoneyInput(cashReceived);

  await page.getByRole('button', { name: 'Orders Board', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Orders Board' })).toBeVisible();
  const rail = page.locator('.board-tabs');
  const tabs = rail.getByRole('tab');
  const [shellBox, firstTabBox, lastTabBox] = await Promise.all([
    page.locator('.orders-board-shell').boundingBox(),
    tabs.first().boundingBox(),
    tabs.last().boundingBox(),
  ]);
  expect(shellBox).not.toBeNull();
  expect(firstTabBox).not.toBeNull();
  expect(lastTabBox).not.toBeNull();
  const tabGroupCenter = (firstTabBox!.x + lastTabBox!.x + lastTabBox!.width) / 2;
  const shellCenter = shellBox!.x + shellBox!.width / 2;
  expect(Math.abs(tabGroupCenter - shellCenter)).toBeLessThanOrEqual(2);

  await page.setViewportSize({ width: 320, height: 900 });
  await expect
    .poll(async () => rail.evaluate((node) => node.scrollWidth > node.clientWidth))
    .toBe(true);
  await rail.evaluate((node) => {
    node.scrollLeft = 0;
  });
  const [narrowRailBox, narrowFirstBox, initialScrollLeft] = await Promise.all([
    rail.boundingBox(),
    tabs.first().boundingBox(),
    rail.evaluate((node) => node.scrollLeft),
  ]);
  expect(narrowRailBox).not.toBeNull();
  expect(narrowFirstBox).not.toBeNull();
  expect(initialScrollLeft).toBe(0);
  expect(narrowFirstBox!.x).toBeGreaterThanOrEqual(narrowRailBox!.x - 1);
  await tabs.last().scrollIntoViewIfNeeded();
  const narrowLastBox = await tabs.last().boundingBox();
  expect(narrowLastBox).not.toBeNull();
  expect(narrowLastBox!.x + narrowLastBox!.width).toBeLessThanOrEqual(
    narrowRailBox!.x + narrowRailBox!.width + 1,
  );

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Expenses', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Expenses' })).toBeVisible();

  const addCard = page.locator('.expense-add-card');
  const addDescription = addCard.getByLabel('Description');
  const addAmount = addCard.getByLabel('Amount');
  const addAmountWrap = addAmount.locator('xpath=..');
  const addPaidOptions = addCard.locator('.expense-paid-options');
  await expectControlTopsAligned([addDescription, addAmountWrap, addPaidOptions]);
  await expectComposedMoneyInput(addAmount);

  await addDescription.fill('Alignment regression');
  await addAmount.fill('25');
  await addAmount.blur();
  await addCard.getByRole('button', { name: 'Add Expense', exact: true }).click();
  const row = page.locator('.expense-row').filter({ hasText: 'Alignment regression' }).first();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Edit', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Edit expense' });
  await expect(dialog).toBeVisible();
  const editDescription = dialog.getByLabel('Description');
  const editAmount = dialog.getByLabel('Amount');
  const editAmountWrap = editAmount.locator('xpath=..');
  const editPaidOptions = dialog.locator('.expense-paid-options');
  await expectControlTopsAligned([editDescription, editAmountWrap, editPaidOptions]);
  await expectComposedMoneyInput(editAmount);

  const dialogBox = await dialog.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(dialogBox!.width).toBeGreaterThanOrEqual(800);
  await page.screenshot({
    path: testInfo.outputPath('ui-alignment-long-term-desktop.png'),
    animations: 'disabled',
    caret: 'hide',
    fullPage: false,
  });
});

test('follow-up desktop approval evidence is captured from the committed tree', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');

  const shot = async (name: string): Promise<void> => {
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(name),
      animations: 'disabled',
      caret: 'hide',
      fullPage: false,
    });
  };

  await enterActiveOrdersForCategoryTests(page);
  await setAppearance(page, 'Light');
  await shot('followup-01-orders-default-1440.png');

  await page.keyboard.press('Control+K');
  const search = page.getByPlaceholder('Search products');
  await search.fill('smashed');
  await shot('followup-02-orders-search-1440.png');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  const editMenu = page.getByRole('button', { name: 'Edit menu' });
  await editMenu.click();
  await expect(editMenu).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Menu edit actions')).toBeVisible();
  await shot('followup-03-orders-menu-edit-1440.png');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  await page.getByRole('button', { name: 'Add one Single Smashed Patty' }).click();
  let cart = currentOrderCart(page, testInfo);
  let line = cart.locator('.cart-line').filter({ hasText: 'Single Smashed Patty' }).first();
  await expect(line.getByRole('button', { name: 'Extra', exact: true })).toBeVisible();
  await expect(line.locator('[data-icon="plus-circle"]')).toHaveCount(1);
  await shot('followup-04-current-order-plain-extra-1440.png');

  await line.getByRole('button', { name: 'Extra', exact: true }).click();
  const extras = page.getByRole('dialog', { name: 'Single Smashed Patty' });
  await extras.getByRole('button', { name: 'Add one Extra Cheese' }).click();
  await extras.getByRole('button', { name: 'Save item' }).click();
  line = cart.locator('.cart-line').filter({ hasText: 'Single Smashed Patty' }).first();
  await expect(line).toContainText('1× Extra Cheese');
  await expect(line.locator('[data-icon="edit-pencil"]')).toHaveCount(1);
  await shot('followup-05-current-order-custom-extra-1440.png');

  const card = page.locator('.product-card').filter({ hasText: 'Single Smashed Patty' }).first();
  await card.getByRole('button', { name: 'Quick Info for Single Smashed Patty' }).click();
  const quickInfo = page.getByRole('dialog', { name: 'Single Smashed Patty' });
  await expect(quickInfo.locator('.quick-info-body p')).toContainText('1 smashed patty');
  await shot('followup-06-quick-info-description-1440.png');
  await quickInfo.getByRole('button', { name: 'Close' }).click();

  cart = currentOrderCart(page, testInfo);
  await cart.getByRole('button', { name: 'Delivery', exact: true }).click();
  await cart.getByLabel('Phone').fill('01000000000');
  await cart.getByLabel('Customer name').fill('Evidence Customer');
  await cart.getByLabel('Zone').selectOption({ index: 1 });
  await cart.getByLabel('Full address').fill('Evidence address');
  const deliveryTotal = cart.getByRole('textbox', { name: 'Delivery', exact: true });
  await expect(deliveryTotal).toBeVisible();
  await deliveryTotal.fill('45');
  await deliveryTotal.blur();
  await shot('followup-07-delivery-fee-totals-1440.png');

  await page.getByRole('button', { name: 'Expenses', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Expenses' })).toBeVisible();
  await expect(page.getByText('No expenses this business day', { exact: true })).toBeVisible();
  await shot('followup-08-expenses-empty-1440.png');

  await page.getByLabel('Description').fill('Packaging bags');
  await page.getByLabel('Amount').fill('25');
  await page.getByLabel('Amount').blur();
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await page.getByLabel(/Note/).fill('Evidence note');
  await page.getByRole('button', { name: 'Add Expense', exact: true }).click();
  await expect(page.getByText('Packaging bags')).toBeVisible();
  await shot('followup-09-expenses-populated-1440.png');

  await setAppearance(page, 'Dark');
  await shot('followup-10-expenses-dark-1440.png');
  await setAppearance(page, 'Light');

  await page.getByRole('button', { name: 'Bulk Stock', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bulk Stock' })).toBeVisible();
  await expect(page.locator('.bulk-stock-card')).toHaveCount(2);
  await shot('followup-11-bulk-stock-populated-1440.png');

  await setAppearance(page, 'Dark');
  await shot('followup-12-bulk-stock-dark-1440.png');
  await setAppearance(page, 'Light');

  const stockCard = page.locator('.bulk-stock-card').filter({ hasText: 'Fries Bulk Bag' });
  await stockCard.getByRole('button', { name: 'Add Stock' }).click();
  const addStock = page.getByRole('dialog', { name: /Add Stock — Fries Bulk Bag/ });
  await expect(addStock.getByLabel('Whole units received')).toBeVisible();
  await shot('followup-13-add-stock-dialog-1440.png');
  await addStock.getByRole('button', { name: 'Cancel' }).click();

  await page.evaluate(async (databaseName) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('inventoryItems', 'readwrite');
      const store = transaction.objectStore('inventoryItems');
      const request = store.getAll();
      request.onsuccess = () => {
        for (const item of request.result as Array<Record<string, unknown>>) {
          if (item['trackingMode'] === 'BULK_MANUAL') store.put({ ...item, active: false });
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  }, DATABASE);
  await page.reload();
  await waitForActiveShell(page);
  await page.getByRole('button', { name: 'Bulk Stock', exact: true }).click();
  await expect(page.locator('.bulk-stock-card')).toHaveCount(0);
  await expect(page.locator('.bulk-stock-empty')).toBeVisible();
  await shot('followup-14-bulk-stock-empty-1440.png');
});

test('follow-up mobile approval evidence is captured from the committed tree', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-browser-fallback');

  const shot = async (name: string): Promise<void> => {
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(name),
      animations: 'disabled',
      caret: 'hide',
      fullPage: false,
    });
  };

  await enterActiveOrdersForCategoryTests(page);
  await setAppearance(page, 'Light');
  await shot('followup-15-orders-default-375.png');

  await page.keyboard.press('Control+K');
  const search = page.getByPlaceholder('Search products');
  await search.fill('smashed');
  await shot('followup-16-orders-search-375.png');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Add one Single Smashed Patty' }).click();
  await openCartIfMobile(page, testInfo);
  const mobileCart = currentOrderCart(page, testInfo);
  await mobileCart.getByRole('button', { name: 'Cash', exact: true }).click();
  await expect(mobileCart.getByLabel('Cash received')).toBeVisible();
  const finalPaymentControl = mobileCart
    .locator(
      '.payment-section button:not([disabled]), .payment-section input:not([disabled]), .payment-section select:not([disabled])',
    )
    .last();
  await finalPaymentControl.scrollIntoViewIfNeeded();
  const footer = mobileCart.locator('.cart-totals');
  const [paymentBox, footerBox] = await Promise.all([
    finalPaymentControl.boundingBox(),
    footer.boundingBox(),
  ]);
  expect(paymentBox).not.toBeNull();
  expect(footerBox).not.toBeNull();
  expect(footerBox!.y - (paymentBox!.y + paymentBox!.height)).toBeGreaterThanOrEqual(16);
  await shot('followup-17-review-pay-bottom-375.png');
  await closeMobileCartIfOpen(page, testInfo);

  await page.getByRole('button', { name: 'Expenses', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Expenses' })).toBeVisible();
  await shot('followup-18-expenses-form-375.png');
  await page.getByLabel('Description').fill('Packaging bags');
  await page.getByLabel('Amount').fill('25');
  await page.getByLabel('Amount').blur();
  await page.getByRole('button', { name: 'Add Expense', exact: true }).click();
  await expect(page.getByText('Packaging bags')).toBeVisible();
  await shot('followup-19-expenses-populated-375.png');

  await page.getByRole('button', { name: 'Bulk Stock', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bulk Stock' })).toBeVisible();
  await shot('followup-20-bulk-stock-populated-375.png');
  const stockCard = page.locator('.bulk-stock-card').filter({ hasText: 'Fries Bulk Bag' });
  await stockCard.getByRole('button', { name: 'Add Stock' }).click();
  await expect(page.getByRole('dialog', { name: /Add Stock — Fries Bulk Bag/ })).toBeVisible();
  await shot('followup-21-add-stock-dialog-375.png');
});

test('cashier-critical controls use the approved operational emphasis', async ({
  page,
}, testInfo) => {
  await enterActiveOrdersForCategoryTests(page);

  const productCard = page
    .locator('.product-card')
    .filter({ hasText: 'Single Smashed Patty' })
    .first();
  const productExtra = productCard.getByRole('button', { name: 'Extra', exact: true });
  expect(await productExtra.evaluate((node) => getComputedStyle(node).fontWeight)).toBe('600');

  await productCard.getByRole('button', { name: 'Add one Single Smashed Patty' }).click();
  await openCartIfMobile(page, testInfo);
  const cart = currentOrderCart(page, testInfo);

  for (const name of ['Take Away', 'Delivery', 'Cash', 'Instapay']) {
    const control = cart.getByRole('button', { name, exact: true });
    await expect(control).toBeVisible();
    expect(await control.evaluate((node) => getComputedStyle(node).fontWeight)).toBe('700');
  }

  for (const name of ['Dine In', 'Split payment']) {
    const control = cart.getByRole('button', { name, exact: true });
    await expect(control).toBeVisible();
    expect(await control.evaluate((node) => getComputedStyle(node).fontWeight)).toBe('600');
  }

  const line = cart.locator('.cart-line').filter({ hasText: 'Single Smashed Patty' }).first();
  for (const name of ['Edit', 'Extra']) {
    const control = line.getByRole('button', { name, exact: true });
    await expect(control).toBeVisible();
    expect(await control.evaluate((node) => getComputedStyle(node).fontWeight)).toBe('600');
  }
});

test('quantity increment is action-colored while decrement stays neutral', async ({
  page,
}, testInfo) => {
  await enterActiveOrdersForCategoryTests(page);

  const productCard = page
    .locator('.product-card')
    .filter({ hasText: 'Single Smashed Patty' })
    .first();
  const productAdd = productCard.getByRole('button', { name: 'Add one Single Smashed Patty' });
  await productAdd.click();
  const productRemove = productCard.getByRole('button', {
    name: 'Remove one Single Smashed Patty',
  });

  expect(await productAdd.evaluate((node) => getComputedStyle(node).fontWeight)).toBe('800');
  expect(await productRemove.evaluate((node) => getComputedStyle(node).fontWeight)).toBe('800');
  expect(await productAdd.evaluate((node) => getComputedStyle(node).color)).not.toBe(
    await productRemove.evaluate((node) => getComputedStyle(node).color),
  );
  const productAddStyle = await productAdd.evaluate((node) => getComputedStyle(node));
  expect(productAddStyle.borderLeftWidth).toBe('1px');
  expect(productAddStyle.borderLeftStyle).toBe('solid');

  await openCartIfMobile(page, testInfo);
  const cart = currentOrderCart(page, testInfo);
  const line = cart.locator('.cart-line').filter({ hasText: 'Single Smashed Patty' }).first();
  const lineAdd = line.getByRole('button', { name: /Increase Single Smashed Patty quantity/ });
  const lineRemove = line.getByRole('button', { name: /Decrease Single Smashed Patty quantity/ });

  expect(await lineAdd.evaluate((node) => getComputedStyle(node).fontWeight)).toBe('800');
  expect(await lineRemove.evaluate((node) => getComputedStyle(node).fontWeight)).toBe('800');
  expect(await lineAdd.evaluate((node) => getComputedStyle(node).color)).not.toBe(
    await lineRemove.evaluate((node) => getComputedStyle(node).color),
  );

  await expect(productAdd).toHaveAttribute('aria-label', 'Add one Single Smashed Patty');
  await expect(productRemove).toHaveAttribute('aria-label', 'Remove one Single Smashed Patty');
  await expect(lineAdd).toHaveAttribute('aria-label', 'Increase Single Smashed Patty quantity');
  await expect(lineRemove).toHaveAttribute('aria-label', 'Decrease Single Smashed Patty quantity');
});

test('respects reduced motion for cashier controls', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await enterActiveOrdersForCategoryTests(page);

  const addButton = page.getByRole('button', { name: 'Add one Single Smashed Patty' });
  await addButton.hover();
  const box = await addButton.boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  expect(await addButton.evaluate((node) => getComputedStyle(node).transform)).toBe('none');
  await page.mouse.up();
});
