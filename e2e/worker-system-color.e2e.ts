import { pbkdf2Sync } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';

const SHOP = '10000000-0000-4000-8000-000000000001';
const WORKER = '20000000-0000-4000-8000-000000000001';
const WORKER_TWO = '20000000-0000-4000-8000-000000000002';
const CATEGORY = '30000000-0000-4000-8000-000000000001';
const PRODUCT = '40000000-0000-4000-8000-000000000001';
const ORDER_TYPE = '70000000-0000-4000-8000-000000000001';
const PAYMENT = '80000000-0000-4000-8000-000000000001';
const DATABASE = 'tux-operations-v2';
const DRAFT_DATABASE = 'tux-operations-v2-drafts';

function pinHash(pin: string): string {
  const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const digest = pbkdf2Sync(pin, salt, 210_000, 32, 'sha256');
  return `pbkdf2-sha256$210000$${salt.toString('hex')}$${digest.toString('hex')}`;
}

function minimalConfiguration() {
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

async function seedBrowserFallback(page: Page): Promise<void> {
  const bundle = minimalConfiguration();
  await page.route('**/__tux_system_color_seed__', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>seed</title>',
    });
  });
  await page.goto('/__tux_system_color_seed__');
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
  await page.unroute('**/__tux_system_color_seed__');
}

async function waitForActiveShell(page: Page): Promise<void> {
  await expect(page.getByRole('navigation', { name: 'Operations' })).toBeVisible({
    timeout: 15_000,
  });
}

async function enterActiveOrders(page: Page): Promise<void> {
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

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    )
    .toBe(true);
}

async function renderedSystemAccent(page: Page): Promise<string> {
  return page
    .locator('html')
    .evaluate((node) =>
      getComputedStyle(node).getPropertyValue('--tux-accent').trim().toLowerCase(),
    );
}

async function setNativeSystemColor(dialog: Locator, color: string): Promise<void> {
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

async function setWorkerAppearance(
  page: Page,
  workerName: string,
  theme: 'Light' | 'Dark' | 'System',
): Promise<void> {
  const operator = page.getByRole('button', { name: new RegExp(workerName) });
  await operator.click();
  await page.getByRole('button', { name: 'System', exact: true }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: theme, exact: true }).click();
  await operator.click();
  if (theme === 'System') {
    await expect.poll(() => page.locator('html').getAttribute('data-theme')).toBeNull();
  } else {
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.toLowerCase());
  }
}

async function openSystemColorDialog(page: Page, workerName: string): Promise<Locator> {
  await page.getByRole('button', { name: new RegExp(workerName) }).click();
  await page.getByRole('button', { name: 'Choose system color', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose system color' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function assertBindingDialog(page: Page, dialog: Locator): Promise<void> {
  await expect(dialog.getByText('Current color', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Visual picker', { exact: true })).toBeVisible();
  await expect(dialog.getByText('HEX', { exact: true })).toBeVisible();
  await expect(dialog.getByText('RGB', { exact: true })).toBeVisible();
  await expect(dialog.locator("input[type='color']")).toHaveCount(1);
  await expect(dialog.locator("input[type='text']")).toHaveCount(1);
  await expect(dialog.locator("input[type='number']")).toHaveCount(3);
  await expect(dialog.locator("input[type='checkbox']")).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Pick from screen', exact: true })).toHaveCount(
    1,
  );
  await expect(
    dialog.getByRole('button', { name: 'Reset to TUX default', exact: true }),
  ).toBeVisible();
  await expect(dialog.locator("input[type='color']")).toBeFocused();

  const viewport = page.viewportSize();
  const box = await dialog.boundingBox();
  expect(viewport).not.toBeNull();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);

  for (const control of [
    dialog.locator("input[type='color']"),
    dialog.getByRole('button', { name: 'Reset to TUX default', exact: true }),
    dialog.getByRole('button', { name: 'Cancel', exact: true }),
    dialog.getByRole('button', { name: 'Save', exact: true }),
  ]) {
    const controlBox = await control.boundingBox();
    expect(controlBox).not.toBeNull();
    expect(controlBox!.height).toBeGreaterThanOrEqual(44);
  }

  const save = dialog.getByRole('button', { name: 'Save', exact: true });
  await page.keyboard.press('Shift+Tab');
  await expect(save).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.locator("input[type='color']")).toBeFocused();
}

async function switchWorker(
  page: Page,
  currentWorker: string,
  pin: string,
  nextWorker: string,
  outgoingAccent: string | null,
): Promise<void> {
  await page.getByRole('button', { name: new RegExp(currentWorker) }).click();
  await page.getByRole('menuitem', { name: 'Switch / Sign in worker' }).click();
  await page.getByLabel('Enter PIN to Sign In').fill(pin);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  if (outgoingAccent !== null) {
    await expect.poll(() => renderedSystemAccent(page)).not.toBe(outgoingAccent);
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

test('worker system color is isolated, persistent, and responsive', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');
  await page.setViewportSize({ width: 1366, height: 768 });
  await enterActiveOrders(page);
  await setWorkerAppearance(page, 'Demo Worker One', 'Light');
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Edit menu' }).click();
  await page.getByRole('button', { name: 'Right', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByLabel('Menu categories')).toHaveAttribute('data-alignment', 'right');

  const defaultLightAccent = await renderedSystemAccent(page);
  let dialog = await openSystemColorDialog(page, 'Demo Worker One');
  await assertBindingDialog(page, dialog);
  await expect(dialog.locator("input[type='color']")).toHaveValue('#1f6b52');
  await setNativeSystemColor(dialog, '#1e3a8a');
  await expect.poll(() => renderedSystemAccent(page)).not.toBe(defaultLightAccent);
  const workerOneLightAccent = await renderedSystemAccent(page);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect.poll(() => renderedSystemAccent(page)).toBe(defaultLightAccent);

  dialog = await openSystemColorDialog(page, 'Demo Worker One');
  await setNativeSystemColor(dialog, '#1e3a8a');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => renderedSystemAccent(page)).toBe(workerOneLightAccent);
  await expect(page.getByLabel('Menu categories')).toHaveAttribute('data-alignment', 'right');
  await page.screenshot({
    path: testInfo.outputPath('system-color-light-blue-desktop.png'),
    animations: 'disabled',
    caret: 'hide',
    fullPage: false,
  });

  await page.reload();
  await waitForActiveShell(page);
  await expect.poll(() => renderedSystemAccent(page)).toBe(workerOneLightAccent);
  await expect(page.getByLabel('Menu categories')).toHaveAttribute('data-alignment', 'right');
  dialog = await openSystemColorDialog(page, 'Demo Worker One');
  await expect(dialog.locator("input[type='color']")).toHaveValue('#1e3a8a');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

  await setWorkerAppearance(page, 'Demo Worker One', 'Dark');
  const workerOneDarkAccent = await renderedSystemAccent(page);
  expect(workerOneDarkAccent).not.toBe(workerOneLightAccent);
  await page.screenshot({
    path: testInfo.outputPath('system-color-dark-blue-desktop.png'),
    animations: 'disabled',
    caret: 'hide',
    fullPage: false,
  });

  await page.emulateMedia({ colorScheme: 'dark' });
  await setWorkerAppearance(page, 'Demo Worker One', 'System');
  await expect.poll(() => renderedSystemAccent(page)).toBe(workerOneDarkAccent);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(() => renderedSystemAccent(page)).toBe(workerOneLightAccent);
  await setWorkerAppearance(page, 'Demo Worker One', 'Light');

  await switchWorker(page, 'Demo Worker One', '5678', 'Demo Worker Two', workerOneLightAccent);
  await expect.poll(() => renderedSystemAccent(page)).toBe(defaultLightAccent);
  dialog = await openSystemColorDialog(page, 'Demo Worker Two');
  await expect(dialog.locator("input[type='color']")).toHaveValue('#1f6b52');
  await setNativeSystemColor(dialog, '#7e22ce');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  const workerTwoLightAccent = await renderedSystemAccent(page);
  expect(workerTwoLightAccent).not.toBe(defaultLightAccent);
  expect(workerTwoLightAccent).not.toBe(workerOneLightAccent);

  await switchWorker(page, 'Demo Worker Two', '1234', 'Demo Worker One', workerTwoLightAccent);
  await expect.poll(() => renderedSystemAccent(page)).toBe(workerOneLightAccent);
  await switchWorker(page, 'Demo Worker One', '5678', 'Demo Worker Two', workerOneLightAccent);
  await expect.poll(() => renderedSystemAccent(page)).toBe(workerTwoLightAccent);

  dialog = await openSystemColorDialog(page, 'Demo Worker Two');
  await dialog.getByRole('button', { name: 'Reset to TUX default', exact: true }).click();
  await expect.poll(() => renderedSystemAccent(page)).toBe(defaultLightAccent);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect.poll(() => renderedSystemAccent(page)).toBe(workerTwoLightAccent);

  dialog = await openSystemColorDialog(page, 'Demo Worker Two');
  await dialog.getByRole('button', { name: 'Reset to TUX default', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => renderedSystemAccent(page)).toBe(defaultLightAccent);
  await page.reload();
  await waitForActiveShell(page);
  await expect.poll(() => renderedSystemAccent(page)).toBe(defaultLightAccent);
  dialog = await openSystemColorDialog(page, 'Demo Worker Two');
  await expect(dialog.locator("input[type='color']")).toHaveValue('#1f6b52');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

  await switchWorker(page, 'Demo Worker Two', '1234', 'Demo Worker One', null);
  await expect.poll(() => renderedSystemAccent(page)).toBe(workerOneLightAccent);

  await page.setViewportSize({ width: 1280, height: 720 });
  await expectNoHorizontalOverflow(page);
  dialog = await openSystemColorDialog(page, 'Demo Worker One');
  await assertBindingDialog(page, dialog);
  await page.screenshot({
    path: testInfo.outputPath('system-color-dialog-1280x720-light.png'),
    animations: 'disabled',
    caret: 'hide',
    fullPage: false,
  });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('worker system color picker is usable on tablet and mobile', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-browser-fallback');
  await enterActiveOrders(page);
  await setWorkerAppearance(page, 'Demo Worker One', 'Light');
  await expectNoHorizontalOverflow(page);

  const savedAccent = await renderedSystemAccent(page);
  const dialog = await openSystemColorDialog(page, 'Demo Worker One');
  await assertBindingDialog(page, dialog);
  await setNativeSystemColor(dialog, '#1e3a8a');
  await expect.poll(() => renderedSystemAccent(page)).not.toBe(savedAccent);

  await page.screenshot({
    path: testInfo.outputPath(
      testInfo.project.name === 'mobile-browser-fallback'
        ? 'system-color-picker-mobile.png'
        : 'system-color-picker-tablet.png',
    ),
    animations: 'disabled',
    caret: 'hide',
    fullPage: false,
  });

  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect.poll(() => renderedSystemAccent(page)).toBe(savedAccent);
  await expectNoHorizontalOverflow(page);
});
