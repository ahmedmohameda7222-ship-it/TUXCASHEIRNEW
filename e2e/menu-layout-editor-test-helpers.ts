import { pbkdf2Sync } from 'node:crypto';
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';

export const MENU_LAYOUT_SHOP = '10000000-0000-4000-8000-000000000001';
export const MENU_LAYOUT_WORKER = '20000000-0000-4000-8000-000000000001';
export const MENU_LAYOUT_WORKER_TWO = '20000000-0000-4000-8000-000000000002';
export const MENU_LAYOUT_DATABASE = 'tux-operations-v2';
export const MENU_LAYOUT_DRAFT_DATABASE = 'tux-operations-v2-drafts';

export function fixtureUuid(prefix: string, index: number): string {
  return `${prefix}-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function pinHash(pin: string): string {
  const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const digest = pbkdf2Sync(pin, salt, 210_000, 32, 'sha256');
  return `pbkdf2-sha256$210000$${salt.toString('hex')}$${digest.toString('hex')}`;
}

function menuLayoutConfiguration() {
  const category = (index: number) => fixtureUuid('30000000', index);
  const product = (index: number) => fixtureUuid('40000000', index);
  const orderType = (index: number) => fixtureUuid('70000000', index);
  const payment = (index: number) => fixtureUuid('80000000', index);

  const products = [
    ['Single Smashed Patty', 1, 'TUX'],
    ['Double Smashed Patty', 1, 'TUX'],
    ['Triple Smashed Patty', 1, 'TUX'],
    ['TUX Quatro Smashed Patty', 1, 'TUX'],
    ['Single TUXIFY', 1, 'TUXIFY'],
    ['Double TUXIFY', 1, 'TUXIFY'],
    ['Triple TUXIFY', 1, 'TUXIFY'],
    ['Quatro TUXIFY', 1, 'TUXIFY'],
    ['Johnny’s', 1, null],
    ['Combo Smash', 2, null],
    ['Classic Fries', 3, null],
    ['Classic Hawawshi', 4, null],
    ['Zalabia', 5, null],
    ['Extra Sauce', 6, null],
    ['Soda', 7, null],
    ['Water', 7, null],
  ].map(([name, categoryIndex, family], index) => ({
    id: product(index + 1),
    shopId: MENU_LAYOUT_SHOP,
    categoryId: category(categoryIndex as number),
    name,
    description:
      categoryIndex === 1
        ? `${name} menu description used by the rendered Menu Layout Editor acceptance fixture.`
        : null,
    priceMinor: 10_000 + index * 1_000,
    imageKey: null,
    active: true,
    soldOut: false,
    family,
    isCombo: false,
    sortOrder: index,
  }));

  return {
    shopId: MENU_LAYOUT_SHOP,
    version: 1,
    updatedAt: '2026-08-20T03:00:00.000Z',
    categories: [
      { id: category(1), shopId: MENU_LAYOUT_SHOP, name: 'Burgers', sortOrder: 0, active: true },
      { id: category(2), shopId: MENU_LAYOUT_SHOP, name: 'Combo', sortOrder: 1, active: true },
      { id: category(3), shopId: MENU_LAYOUT_SHOP, name: 'Fries', sortOrder: 2, active: true },
      { id: category(4), shopId: MENU_LAYOUT_SHOP, name: 'Hawawshi', sortOrder: 3, active: true },
      { id: category(5), shopId: MENU_LAYOUT_SHOP, name: 'Zalabia', sortOrder: 4, active: true },
      { id: category(6), shopId: MENU_LAYOUT_SHOP, name: 'Extras', sortOrder: 5, active: true },
      { id: category(7), shopId: MENU_LAYOUT_SHOP, name: 'Drinks', sortOrder: 6, active: true },
    ],
    products,
    modifiers: [],
    productModifierLinks: [],
    comboBeverageOptions: [],
    recipeLines: [],
    orderTypes: [
      {
        id: orderType(1),
        shopId: MENU_LAYOUT_SHOP,
        name: 'Take Away',
        behavior: 'TAKE_AWAY',
        sortOrder: 0,
        active: true,
      },
      {
        id: orderType(2),
        shopId: MENU_LAYOUT_SHOP,
        name: 'Dine In',
        behavior: 'DINE_IN',
        sortOrder: 1,
        active: true,
      },
      {
        id: orderType(3),
        shopId: MENU_LAYOUT_SHOP,
        name: 'Delivery',
        behavior: 'DELIVERY',
        sortOrder: 2,
        active: true,
      },
    ],
    paymentMethods: [
      {
        id: payment(1),
        shopId: MENU_LAYOUT_SHOP,
        displayName: 'Cash',
        logicType: 'CASH',
        requiresReconciliation: true,
        sortOrder: 0,
        active: true,
      },
      {
        id: payment(2),
        shopId: MENU_LAYOUT_SHOP,
        displayName: 'Instapay',
        logicType: 'DIGITAL',
        requiresReconciliation: true,
        sortOrder: 1,
        active: true,
      },
    ],
    deliveryZones: [],
  };
}

export async function seedMenuLayoutBrowserFallback(page: Page): Promise<void> {
  const snapshot = menuLayoutConfiguration();
  await page.route('**/__tux_menu_layout_seed__', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>seed</title>',
    });
  });
  await page.goto('/__tux_menu_layout_seed__');
  await page.evaluate(
    async ({ databaseName, draftDatabaseName, shopId, workerId, workerTwoId, hashes, snapshot }) => {
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
        const tx = database.transaction(['shops', 'workers', 'configurationSnapshots'], 'readwrite');
        tx.objectStore('shops').put({ id: shopId, name: 'TUX E2E Shop', active: true });
        tx.objectStore('workers').put({
          id: workerId,
          shopId,
          displayName: 'Demo Worker One',
          pinHash: hashes.worker,
          active: true,
        });
        tx.objectStore('workers').put({
          id: workerTwoId,
          shopId,
          displayName: 'Demo Worker Two',
          pinHash: hashes.workerTwo,
          active: true,
        });
        tx.objectStore('configurationSnapshots').put(snapshot);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      database.close();
    },
    {
      databaseName: MENU_LAYOUT_DATABASE,
      draftDatabaseName: MENU_LAYOUT_DRAFT_DATABASE,
      shopId: MENU_LAYOUT_SHOP,
      workerId: MENU_LAYOUT_WORKER,
      workerTwoId: MENU_LAYOUT_WORKER_TWO,
      hashes: { worker: pinHash('1234'), workerTwo: pinHash('5678') },
      snapshot,
    },
  );
  await page.unroute('**/__tux_menu_layout_seed__');
}

export async function startMenuLayoutActiveOrders(page: Page): Promise<void> {
  await seedMenuLayoutBrowserFallback(page);
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
  await expect(page.getByRole('navigation', { name: 'Operations' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('button', { name: 'Edit menu' })).toBeEnabled();
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    )
    .toBe(true);
}

export async function attachMenuLayoutScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  const body = await page.screenshot({ animations: 'disabled', caret: 'hide', fullPage: false });
  await testInfo.attach(name, { body, contentType: 'image/png' });
}

export function menuCategoryTabs(page: Page): Locator {
  return page.getByLabel('Menu categories').locator('.category-tab');
}

export function menuEditProductCards(page: Page): Locator {
  return page.locator('.menu-edit-product-card');
}

export async function menuLayoutDraftSnapshot(page: Page): Promise<{
  readonly categories: readonly string[];
  readonly products: readonly string[];
  readonly alignment: string;
}> {
  const categories = await menuCategoryTabs(page).allTextContents();
  const products = await menuEditProductCards(page).evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('aria-label') ?? ''),
  );
  const alignment =
    (await page
      .getByRole('group', { name: 'Category alignment' })
      .getByRole('button')
      .evaluateAll(
        (buttons) =>
          buttons.find((button) => button.getAttribute('aria-pressed') === 'true')?.textContent ?? '',
      )) ?? '';
  return { categories, products, alignment };
}

export async function mouseDrag(source: Locator, target: Locator, page: Page): Promise<void> {
  const [sourceBox, targetBox] = await Promise.all([source.boundingBox(), target.boundingBox()]);
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  const startX = sourceBox!.x + sourceBox!.width / 2;
  const startY = sourceBox!.y + sourceBox!.height / 2;
  const endX = targetBox!.x + targetBox!.width / 2;
  const endY = targetBox!.y + targetBox!.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 8, startY + 4, { steps: 2 });
  await page.mouse.move(endX, endY, { steps: 8 });
  await page.mouse.up();
}

export async function touchDrag(source: Locator, target: Locator, page: Page): Promise<void> {
  const [sourceBox, targetBox] = await Promise.all([source.boundingBox(), target.boundingBox()]);
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  const startX = sourceBox!.x + sourceBox!.width / 2;
  const startY = sourceBox!.y + sourceBox!.height / 2;
  const endX = targetBox!.x + targetBox!.width / 2;
  const endY = targetBox!.y + targetBox!.height / 2;
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: startX, y: startY, id: 1, radiusX: 2, radiusY: 2, force: 1 }],
  });
  await page.waitForTimeout(180);
  for (let step = 1; step <= 8; step += 1) {
    const ratio = step / 8;
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        {
          x: startX + (endX - startX) * ratio,
          y: startY + (endY - startY) * ratio,
          id: 1,
          radiusX: 2,
          radiusY: 2,
          force: 1,
        },
      ],
    });
    await page.waitForTimeout(24);
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
}

export async function installPreferenceSaveFailure(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scope = window as typeof window & {
      __tuxMenuLayoutOriginalPut?: typeof IDBObjectStore.prototype.put;
    };
    if (scope.__tuxMenuLayoutOriginalPut !== undefined) return;
    const original = IDBObjectStore.prototype.put;
    scope.__tuxMenuLayoutOriginalPut = original;
    IDBObjectStore.prototype.put = function put(value: unknown, key?: IDBValidKey): IDBRequest {
      if (this.name === 'workerUiPreferences') throw new Error('Forced menu layout save failure');
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    };
  });
}

export async function restorePreferenceSave(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scope = window as typeof window & {
      __tuxMenuLayoutOriginalPut?: typeof IDBObjectStore.prototype.put;
    };
    if (scope.__tuxMenuLayoutOriginalPut === undefined) return;
    IDBObjectStore.prototype.put = scope.__tuxMenuLayoutOriginalPut;
    delete scope.__tuxMenuLayoutOriginalPut;
  });
}

export async function holdPreferenceWriteTransaction(page: Page): Promise<void> {
  await page.evaluate(async (databaseName) => {
    const scope = window as typeof window & { __tuxMenuLayoutReleaseWrite?: boolean };
    scope.__tuxMenuLayoutReleaseWrite = false;
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('workerUiPreferences', 'readwrite');
    const store = transaction.objectStore('workerUiPreferences');
    const keepAlive = (): void => {
      if (scope.__tuxMenuLayoutReleaseWrite) {
        database.close();
        return;
      }
      const request = store.get(['00000000-0000-4000-8000-000000000000']);
      request.onsuccess = keepAlive;
      request.onerror = keepAlive;
    };
    keepAlive();
  }, MENU_LAYOUT_DATABASE);
}

export async function releasePreferenceWriteTransaction(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scope = window as typeof window & { __tuxMenuLayoutReleaseWrite?: boolean };
    scope.__tuxMenuLayoutReleaseWrite = true;
  });
}
