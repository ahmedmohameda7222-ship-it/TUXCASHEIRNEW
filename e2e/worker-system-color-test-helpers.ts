import { pbkdf2Sync } from 'node:crypto';
import { expect, type Locator, type Page } from '@playwright/test';

export const SHOP = '10000000-0000-4000-8000-000000000001';
export const WORKER = '20000000-0000-4000-8000-000000000001';
export const WORKER_TWO = '20000000-0000-4000-8000-000000000002';
export const CATEGORY = '30000000-0000-4000-8000-000000000001';
export const PRODUCT = '40000000-0000-4000-8000-000000000001';
export const ORDER_TYPE = '70000000-0000-4000-8000-000000000001';
export const PAYMENT = '80000000-0000-4000-8000-000000000001';
export const DATABASE = 'tux-operations-v2';
export const DRAFT_DATABASE = 'tux-operations-v2-drafts';

function pinHash(pin: string): string {
  const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const digest = pbkdf2Sync(pin, salt, 210_000, 32, 'sha256');
  return `pbkdf2-sha256$210000$${salt.toString('hex')}$${digest.toString('hex')}`;
}

export function minimalConfiguration() {
  return {
    snapshot: {
      shopId: SHOP,
      version: 1,
      updatedAt: '2026-08-28T12:00:00.000Z',
      categories: [{ id: CATEGORY, shopId: SHOP, name: 'Burgers', sortOrder: 0, active: true }],
      products: [
        {
          id: PRODUCT,
          shopId: SHOP,
          categoryId: CATEGORY,
          name: 'Single Smashed Patty',
          description: '1 smashed patty, cheese, TUX sauce, tomatoes, pickles, lettuce',
          priceMinor: 12_000,
          imageKey: null,
          family: 'TUX',
          active: true,
          soldOut: false,
          isCombo: false,
          sortOrder: 0,
        },
      ],
      modifiers: [],
      productModifierLinks: [],
      comboBeverageOptions: [],
      recipeLines: [],
      orderTypes: [
        {
          id: ORDER_TYPE,
          shopId: SHOP,
          name: 'Take Away',
          behavior: 'TAKE_AWAY',
          sortOrder: 0,
          active: true,
        },
      ],
      paymentMethods: [
        {
          id: PAYMENT,
          shopId: SHOP,
          displayName: 'Cash',
          logicType: 'CASH',
          requiresReconciliation: true,
          sortOrder: 0,
          active: true,
        },
      ],
      deliveryZones: [],
    },
    inventoryItems: [],
  };
}

export async function seedBrowserFallback(page: Page, origin = ''): Promise<void> {
  const bundle = minimalConfiguration();
  await page.route('**/__tux_system_color_planner_seed__', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>seed</title>',
    });
  });
  await page.goto(`${origin}/__tux_system_color_planner_seed__`);
  await page.evaluate(
    async ({
      databaseName,
      draftDatabaseName,
      shopId,
      workerId,
      workerTwoId,
      workerPinHash,
      workerTwoPinHash,
      configuration,
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
          ['shops', 'workers', 'configurationSnapshots'],
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
        tx.objectStore('configurationSnapshots').put(configuration.snapshot);
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
      configuration: bundle,
    },
  );
  await page.unroute('**/__tux_system_color_planner_seed__');
}

export async function waitForActiveShell(page: Page): Promise<void> {
  await expect(page.getByRole('navigation', { name: 'Operations' })).toBeVisible({
    timeout: 15_000,
  });
}

export async function enterActiveOrders(page: Page, origin = ''): Promise<void> {
  await seedBrowserFallback(page, origin);
  await page.goto(`${origin}/`);
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

export async function prepareRenderedOrderControls(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Add one Single Smashed Patty' }).click();
  await page.getByRole('button', { name: 'Take Away', exact: true }).click();
  await page.getByRole('button', { name: 'Cash', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Place Order', exact: true })).toBeEnabled();
}

export async function renderedSystemAccent(page: Page): Promise<string> {
  return page
    .locator('html')
    .evaluate((node) =>
      getComputedStyle(node).getPropertyValue('--tux-accent').trim().toLowerCase(),
    );
}

export async function setNativeSystemColor(dialog: Locator, color: string): Promise<void> {
  const picker = dialog.locator("input[type='color']");
  await expect(picker).toBeEnabled();
  await picker.evaluate((node, nextColor) => {
    const input = node as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter === undefined) throw new Error('Native input value setter is unavailable.');
    setter.call(input, nextColor);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, color);
  await expect(picker).toHaveValue(color);
}

export async function setWorkerAppearance(
  page: Page,
  workerName: string,
  theme: 'Light' | 'Dark',
): Promise<void> {
  const operator = page.getByRole('button', { name: new RegExp(workerName) });
  await operator.click();
  await page.getByRole('button', { name: theme, exact: true }).click();
  await operator.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme.toLowerCase());
}

export async function openSystemColorDialog(page: Page, workerName: string): Promise<Locator> {
  await page.getByRole('button', { name: new RegExp(workerName) }).click();
  await page.getByRole('button', { name: 'Choose system color', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose system color' });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function switchWorker(
  page: Page,
  currentWorker: string,
  pin: string,
  nextWorker: string,
  force = false,
): Promise<void> {
  const operator = page.getByRole('button', { name: new RegExp(currentWorker) });
  if (force) {
    await operator.evaluate((node) => (node as HTMLButtonElement).click());
    const switchItem = page.locator('.operator-menu [role="menuitem"]', {
      hasText: 'Switch / Sign in worker',
    });
    await expect(switchItem).toBeAttached();
    await switchItem.evaluate((node) => (node as HTMLButtonElement).click());
    const switchDialog = page.locator('.switch-dialog');
    await expect(switchDialog).toBeAttached();
    await switchDialog.locator('input[name="worker-pin"]').fill(pin, { force: true });
    await switchDialog
      .locator('button.primary-action')
      .evaluate((node) => (node as HTMLButtonElement).click());
  } else {
    await operator.click();
    await page.getByRole('menuitem', { name: 'Switch / Sign in worker' }).click();
    await page.getByLabel('Enter PIN to Sign In').fill(pin);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  }
  const nextOperator = page.getByRole('button', { name: new RegExp(nextWorker) });
  const nextGreeting = page.getByRole('heading', { name: new RegExp(nextWorker) });
  await expect
    .poll(
      async () =>
        (await nextGreeting.isVisible().catch(() => false)) ||
        (await nextOperator.isVisible().catch(() => false)),
    )
    .toBe(true);
  if (await nextGreeting.isVisible().catch(() => false)) {
    const welcomeAction = page.locator('.welcome-action');
    await expect(welcomeAction).toBeVisible();
    await welcomeAction.click();
  }
  await waitForActiveShell(page);
  await expect(nextOperator).toBeVisible();
}
