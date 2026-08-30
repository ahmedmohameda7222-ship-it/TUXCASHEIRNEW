import { pbkdf2Sync } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';

const SHOP = '10000000-0000-4000-8000-000000000001';
const WORKER = '20000000-0000-4000-8000-000000000001';
const CATEGORY = '30000000-0000-4000-8000-000000000001';
const PRODUCT = '40000000-0000-4000-8000-000000000001';
const ORDER_TYPE = '70000000-0000-4000-8000-000000000001';
const PAYMENT = '80000000-0000-4000-8000-000000000001';
const DATABASE = 'tux-operations-v2';
const DRAFT_DATABASE = 'tux-operations-v2-drafts';
const MIN_DESTRUCTIVE_DISTANCE = 72;

const RENDERED_COLOR_MATRIX = [
  '#1f6b52',
  '#1e3a8a',
  '#7e22ce',
  '#dc2626',
  '#facc15',
  '#050505',
  '#fafafa',
] as const;

type CssRgb = readonly [number, number, number];

interface ComputedPaint {
  readonly backgroundColor: string;
  readonly color: string;
  readonly outlineColor: string;
  readonly outlineStyle: string;
  readonly outlineWidth: string;
}

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

function parseComputedColor(value: string): CssRgb {
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith('rgb(') || normalized.startsWith('rgba(')) {
    const start = normalized.indexOf('(') + 1;
    const end = normalized.lastIndexOf(')');
    const channels = normalized
      .slice(start, end)
      .split(/[\s,/]+/)
      .filter(Boolean)
      .slice(0, 3)
      .map(Number);
    if (channels.length === 3 && channels.every(Number.isFinite)) {
      return [channels[0]!, channels[1]!, channels[2]!];
    }
  }
  if (normalized.startsWith('color(srgb ')) {
    const channels = normalized
      .slice('color(srgb '.length, -1)
      .split(/[\s/]+/)
      .filter(Boolean)
      .slice(0, 3)
      .map((channel) => Number(channel) * 255);
    if (channels.length === 3 && channels.every(Number.isFinite)) {
      return [channels[0]!, channels[1]!, channels[2]!];
    }
  }
  throw new Error(`Unsupported computed CSS color: ${value}`);
}

function linearChannel(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]: CssRgb): number {
  return 0.2126 * linearChannel(r) + 0.7152 * linearChannel(g) + 0.0722 * linearChannel(b);
}

function contrastRatio(left: string, right: string): number {
  const leftLuminance = luminance(parseComputedColor(left));
  const rightLuminance = luminance(parseComputedColor(right));
  return (
    (Math.max(leftLuminance, rightLuminance) + 0.05) /
    (Math.min(leftLuminance, rightLuminance) + 0.05)
  );
}

function colorDistance(left: string, right: string): number {
  const [lr, lg, lb] = parseComputedColor(left);
  const [rr, rg, rb] = parseComputedColor(right);
  return Math.hypot(lr - rr, lg - rg, lb - rb);
}

async function computedPaint(locator: Locator): Promise<ComputedPaint> {
  return locator.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      backgroundColor: style.backgroundColor,
      color: style.color,
      outlineColor: style.outlineColor,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
  });
}

async function seedBrowserFallback(page: Page): Promise<void> {
  const bundle = minimalConfiguration();
  await page.route('**/__tux_system_color_matrix_seed__', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>seed</title>',
    });
  });
  await page.goto('/__tux_system_color_matrix_seed__');
  await page.evaluate(
    async ({ databaseName, draftDatabaseName, shopId, workerId, workerPinHash, configuration }) => {
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
      workerPinHash: pinHash('1234'),
      configuration: bundle,
    },
  );
  await page.unroute('**/__tux_system_color_matrix_seed__');
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
  await expect(page.getByRole('navigation', { name: 'Operations' })).toBeVisible({
    timeout: 15_000,
  });
}

async function prepareRenderedOrderControls(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Add one Single Smashed Patty' }).click();
  await page.getByRole('button', { name: 'Take Away', exact: true }).click();
  await page.getByRole('button', { name: 'Cash', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Place Order', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Clear', exact: true })).toBeEnabled();
}

async function setWorkerAppearance(
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

async function openSystemColorDialog(page: Page, workerName: string): Promise<Locator> {
  await page.getByRole('button', { name: new RegExp(workerName) }).click();
  await page.getByRole('button', { name: 'Choose system color', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose system color' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("input[type='color']")).toBeFocused();
  return dialog;
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
  await picker.focus();
}

async function assertSoftSelection(locator: Locator, label: string): Promise<void> {
  await expect(locator, `${label} should be visible`).toBeVisible();
  const paint = await computedPaint(locator);
  expect(contrastRatio(paint.backgroundColor, paint.color), label).toBeGreaterThanOrEqual(4.5);
}

async function assertFocusedPicker(dialog: Locator): Promise<void> {
  const picker = dialog.locator("input[type='color']");
  await picker.focus();
  await expect(picker).toBeFocused();
  const pickerPaint = await computedPaint(picker);
  const dialogPaint = await computedPaint(dialog);
  expect(pickerPaint.outlineStyle).not.toBe('none');
  expect(Number.parseFloat(pickerPaint.outlineWidth)).toBeGreaterThanOrEqual(3);
  expect(
    contrastRatio(pickerPaint.outlineColor, dialogPaint.backgroundColor),
  ).toBeGreaterThanOrEqual(3);
}

async function semanticStatusColors(page: Page): Promise<{
  positive: string;
  warning: string;
  destructive: string;
}> {
  return page.locator('html').evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      positive: style.getPropertyValue('--tux-positive').trim(),
      warning: style.getPropertyValue('--tux-warning').trim(),
      destructive: style.getPropertyValue('--tux-destructive').trim(),
    };
  });
}

async function assertRenderedControls(page: Page, appearance: 'Light' | 'Dark'): Promise<void> {
  const placeOrder = page.getByRole('button', { name: 'Place Order', exact: true });
  const actionPaint = await computedPaint(placeOrder);
  const totalsPaint = await computedPaint(page.locator('.cart-totals'));
  expect(
    contrastRatio(actionPaint.backgroundColor, actionPaint.color),
    'Place Order text',
  ).toBeGreaterThanOrEqual(4.5);
  expect(
    contrastRatio(actionPaint.backgroundColor, totalsPaint.backgroundColor),
    'Place Order boundary',
  ).toBeGreaterThanOrEqual(3);

  await assertSoftSelection(
    page.locator('.operations-header .nav-item-active'),
    'active navigation',
  );
  await assertSoftSelection(
    page.locator('.menu-toolbar .category-rail button.selected'),
    'selected category',
  );
  await assertSoftSelection(
    page.locator('.order-type-section .segmented-control button.selected'),
    'selected order type',
  );
  await assertSoftSelection(page.locator('.payment-methods button.selected'), 'selected payment');

  const operator = page.getByRole('button', { name: /Demo Worker One/ });
  await operator.click();
  await assertSoftSelection(
    page.locator('.operator-menu .appearance-option-active'),
    `selected ${appearance} appearance`,
  );
  await operator.click();

  const destructivePaint = await computedPaint(
    page.getByRole('button', { name: 'Clear', exact: true }),
  );
  expect(
    colorDistance(actionPaint.backgroundColor, destructivePaint.color),
    'brand/destructive separation',
  ).toBeGreaterThanOrEqual(MIN_DESTRUCTIVE_DISTANCE);
}

test('worker system color robustness matrix verifies actual rendered controls in light and dark', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');
  await page.setViewportSize({ width: 1366, height: 768 });
  await enterActiveOrders(page);
  await prepareRenderedOrderControls(page);

  for (const appearance of ['Light', 'Dark'] as const) {
    await setWorkerAppearance(page, 'Demo Worker One', appearance);
    const semanticBaseline = await semanticStatusColors(page);
    expect(semanticBaseline.positive).not.toBe('');
    expect(semanticBaseline.warning).not.toBe('');
    expect(semanticBaseline.destructive).not.toBe('');

    for (const color of RENDERED_COLOR_MATRIX) {
      const dialog = await openSystemColorDialog(page, 'Demo Worker One');
      await setNativeSystemColor(dialog, color);
      await assertFocusedPicker(dialog);
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(page.locator('html')).toHaveAttribute('data-tux-custom-accent', 'true');
      await assertRenderedControls(page, appearance);
      expect(await semanticStatusColors(page)).toEqual(semanticBaseline);
    }
  }
});

test('system color dialog remains usable without horizontal clipping at every supported viewport', async ({
  page,
}) => {
  await enterActiveOrders(page);
  const dialog = await openSystemColorDialog(page, 'Demo Worker One');
  const viewport = page.viewportSize();
  const box = await dialog.boundingBox();
  expect(viewport).not.toBeNull();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
  await expect(dialog.locator("input[type='color']")).toBeVisible();
  await expect(dialog.getByLabel('HEX')).toBeVisible();
  await expect(dialog.getByLabel('Red')).toBeVisible();
  await expect(dialog.getByLabel('Green')).toBeVisible();
  await expect(dialog.getByLabel('Blue')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
});
