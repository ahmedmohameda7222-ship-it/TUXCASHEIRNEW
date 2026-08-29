import { pbkdf2Sync } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';

const SHOP = '10000000-0000-4000-8000-000000000001';
const WORKER_A = '20000000-0000-4000-8000-000000000001';
const WORKER_B = '20000000-0000-4000-8000-000000000002';
const CATEGORY = '30000000-0000-4000-8000-000000000001';
const PRODUCT = '40000000-0000-4000-8000-000000000001';
const ORDER_TYPE = '70000000-0000-4000-8000-000000000001';
const PAYMENT = '80000000-0000-4000-8000-000000000001';
const DATABASE = 'tux-operations-v2';
const DRAFT_DATABASE = 'tux-operations-v2-drafts';
const REMOTE_ORIGIN = 'http://tux.localhost:4173';
const COLOR_MATRIX = ['#1f6b52', '#1e3a8a', '#7e22ce', '#dc2626', '#facc15', '#050505', '#fafafa'];

type Paint = {
  readonly backgroundColor: string;
  readonly borderColor: string;
  readonly color: string;
  readonly outlineColor: string;
  readonly outlineWidth: string;
};

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
      updatedAt: '2026-08-29T10:00:00.000Z',
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

async function seedBrowser(page: Page, origin = ''): Promise<void> {
  const bundle = minimalConfiguration();
  const seedUrl = `${origin}/__tux_worker_color_planner_seed__`;
  await page.route('**/__tux_worker_color_planner_seed__', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>seed</title>' });
  });
  await page.goto(seedUrl || '/__tux_worker_color_planner_seed__');
  await page.evaluate(
    async ({ databaseName, draftDatabaseName, shopId, workerA, workerB, pinA, pinB, configuration }) => {
      const remove = (name: string) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
          request.onblocked = () => reject(new Error(`Delete blocked for ${name}`));
        });
      await Promise.all([remove(databaseName), remove(draftDatabaseName)]);
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
          const inventory = db.createObjectStore('inventoryItems', { keyPath: 'id' });
          inventory.createIndex('shopTrackingMode', ['shopId', 'trackingMode']);
          const movements = db.createObjectStore('inventoryMovements', { keyPath: 'id' });
          movements.createIndex('shopIdempotency', ['shopId', 'idempotencyKey'], { unique: true });
          const reconciliations = db.createObjectStore('reconciliations', { keyPath: 'id' });
          reconciliations.createIndex('shopBusinessDay', ['shopId', 'businessDayId'], { unique: true });
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
        tx.objectStore('workers').put({ id: workerA, shopId, displayName: 'Demo Worker One', pinHash: pinA, active: true });
        tx.objectStore('workers').put({ id: workerB, shopId, displayName: 'Demo Worker Two', pinHash: pinB, active: true });
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
      workerA: WORKER_A,
      workerB: WORKER_B,
      pinA: pinHash('1234'),
      pinB: pinHash('5678'),
      configuration: bundle,
    },
  );
  await page.unroute('**/__tux_worker_color_planner_seed__');
}

async function enterActiveOrders(page: Page, origin = ''): Promise<void> {
  await seedBrowser(page, origin);
  await page.goto(origin ? `${origin}/` : '/');
  await page.getByLabel('Enter PIN to Start Day').fill('1234');
  await page.getByRole('button', { name: 'Start Day' }).click();
  await page.waitForFunction(() => document.querySelector('.welcome-action') !== null || document.querySelector('[aria-label="Operations"]') !== null);
  const welcome = page.locator('.welcome-action');
  if (await welcome.isVisible().catch(() => false)) await welcome.click();
  await expect(page.getByRole('navigation', { name: 'Operations' })).toBeVisible({ timeout: 15_000 });
}

async function prepareOrder(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Add one Single Smashed Patty' }).click();
  await page.getByRole('button', { name: 'Take Away', exact: true }).click();
  await page.getByRole('button', { name: 'Cash', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Place Order', exact: true })).toBeEnabled();
}

async function setAppearance(page: Page, worker: string, appearance: 'Light' | 'Dark'): Promise<void> {
  const operator = page.getByRole('button', { name: new RegExp(worker) });
  await operator.click();
  await page.getByRole('button', { name: appearance, exact: true }).click();
  await operator.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', appearance.toLowerCase());
}

async function openDialog(page: Page, worker: string): Promise<Locator> {
  await page.getByRole('button', { name: new RegExp(worker) }).click();
  await page.getByRole('button', { name: 'Choose system color', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose system color' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function setNative(dialog: Locator, color: string): Promise<void> {
  await dialog.locator("input[type='color']").evaluate((node, value) => {
    const input = node as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter === undefined) throw new Error('Native color setter unavailable.');
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, color);
}

async function accent(page: Page): Promise<string> {
  return page.locator('html').evaluate((node) => getComputedStyle(node).getPropertyValue('--tux-accent').trim().toLowerCase());
}

async function paint(locator: Locator): Promise<Paint> {
  return locator.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      color: style.color,
      outlineColor: style.outlineColor,
      outlineWidth: style.outlineWidth,
    };
  });
}

async function resolvedColor(page: Page, expression: string): Promise<string> {
  return page.evaluate((value) => {
    const node = document.createElement('span');
    node.style.color = value;
    document.body.append(node);
    const color = getComputedStyle(node).color;
    node.remove();
    return color;
  }, expression);
}

function rgb(value: string): readonly [number, number, number] {
  const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
  if (channels.length !== 3) throw new Error(`Unsupported computed color ${value}`);
  return [channels[0]!, channels[1]!, channels[2]!];
}

function luminance(value: string): number {
  const [r, g, b] = rgb(value).map((channel) => {
    const next = channel / 255;
    return next <= 0.04045 ? next / 12.92 : ((next + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(left: string, right: string): number {
  const a = luminance(left);
  const b = luminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

async function switchWorker(page: Page, current: string, pin: string, next: string, force = false): Promise<void> {
  await page.getByRole('button', { name: new RegExp(current) }).click({ force });
  await page.getByRole('menuitem', { name: 'Switch / Sign in worker' }).click({ force });
  await page.getByLabel('Enter PIN to Sign In').fill(pin, { force });
  await page.getByRole('button', { name: 'Sign In', exact: true }).click({ force });
  const nextOperator = page.getByRole('button', { name: new RegExp(next) });
  const greeting = page.getByRole('heading', { name: new RegExp(next) });
  await expect.poll(async () => (await nextOperator.isVisible().catch(() => false)) || (await greeting.isVisible().catch(() => false))).toBe(true);
  if (await greeting.isVisible().catch(() => false)) await page.locator('.welcome-action').click();
  await expect(nextOperator).toBeVisible();
}

test('null worker accent preserves canonical TUX computed styles in Light and Dark', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');
  await enterActiveOrders(page);
  await prepareOrder(page);

  for (const appearance of ['Light', 'Dark'] as const) {
    await setAppearance(page, 'Demo Worker One', appearance);
    await expect(page.locator('html')).not.toHaveAttribute('data-tux-custom-accent', 'true');
    const accentColor = await resolvedColor(page, 'var(--tux-accent)');
    const soft = await resolvedColor(page, 'var(--tux-accent-soft)');
    const accentText = await resolvedColor(page, 'var(--tux-accent-text)');
    const strong = await resolvedColor(page, 'var(--tux-accent-strong)');
    const actionForeground = await resolvedColor(page, 'var(--tux-action-foreground)');
    const canonicalFocus = await resolvedColor(page, 'color-mix(in srgb, var(--tux-focus-ring) 70%, transparent)');

    const placeOrder = page.getByRole('button', { name: 'Place Order', exact: true });
    const placePaint = await paint(placeOrder);
    expect(placePaint.backgroundColor).toBe(accentColor);
    expect(placePaint.borderColor).toBe(accentColor);
    expect(placePaint.color).toBe(actionForeground);

    for (const locator of [
      page.locator('.operations-header .nav-item-active'),
      page.locator('.menu-toolbar .category-rail button.selected'),
      page.locator('.order-type-section .segmented-control button.selected'),
      page.locator('.payment-methods button.selected'),
    ]) {
      const selected = await paint(locator);
      expect(selected.backgroundColor).toBe(soft);
      expect(selected.color).toBe(accentText);
    }

    const operator = page.getByRole('button', { name: /Demo Worker One/ });
    await operator.click();
    const appearancePaint = await paint(page.locator('.operator-menu .appearance-option-active'));
    expect(appearancePaint.backgroundColor).toBe(soft);
    expect(appearancePaint.color).toBe(strong);
    await operator.click();

    await placeOrder.focus();
    const focused = await paint(placeOrder);
    expect(focused.outlineWidth).toBe('3px');
    expect(focused.outlineColor).toBe(canonicalFocus);
  }
});

test('custom action foreground stays readable for normal hover and pressed matrix states', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');
  await enterActiveOrders(page);
  await prepareOrder(page);

  for (const appearance of ['Light', 'Dark'] as const) {
    await setAppearance(page, 'Demo Worker One', appearance);
    for (const color of COLOR_MATRIX) {
      const dialog = await openDialog(page, 'Demo Worker One');
      await setNative(dialog, color);
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(dialog).toBeHidden();

      const placeOrder = page.getByRole('button', { name: 'Place Order', exact: true });
      const normal = await paint(placeOrder);
      expect(contrast(normal.backgroundColor, normal.color), `${appearance} ${color} normal`).toBeGreaterThanOrEqual(4.5);
      await placeOrder.hover();
      const hovered = await paint(placeOrder);
      expect(contrast(hovered.backgroundColor, hovered.color), `${appearance} ${color} hover`).toBeGreaterThanOrEqual(4.5);
      const box = await placeOrder.boundingBox();
      expect(box).not.toBeNull();
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await page.mouse.down();
      const pressed = await paint(placeOrder);
      expect(contrast(pressed.backgroundColor, pressed.color), `${appearance} ${color} pressed`).toBeGreaterThanOrEqual(4.5);
      expect(hovered.backgroundColor).not.toBe(normal.backgroundColor);
      expect(pressed.backgroundColor).not.toBe(hovered.backgroundColor);
      await page.mouse.move(1, 1);
      await page.mouse.up();

      await page.getByRole('button', { name: 'Edit menu' }).click();
      const primary = page.locator('.menu-edit-actions .primary-action');
      const primaryPaint = await paint(primary);
      expect(contrast(primaryPaint.backgroundColor, primaryPaint.color), `${appearance} ${color} primary`).toBeGreaterThanOrEqual(4.5);
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
  }
});

test('HEX RGB native picker and EyeDropper synchronize without corrupting normal HEX typing', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');
  await enterActiveOrders(page);
  const originalAccent = await accent(page);
  await page.evaluate(() => {
    (window as Window & { EyeDropper?: unknown }).EyeDropper = class {
      async open() {
        return { sRGBHex: '#DC2626' };
      }
    };
  });
  let dialog = await openDialog(page, 'Demo Worker One');
  const hex = dialog.getByLabel('HEX');
  await hex.clear();
  await hex.pressSequentially('#1E3A8A');
  await expect(hex).toHaveValue('#1E3A8A');
  await expect(dialog.getByLabel('Red')).toHaveValue('30');
  await expect(dialog.getByLabel('Green')).toHaveValue('58');
  await expect(dialog.getByLabel('Blue')).toHaveValue('138');
  await expect(dialog.locator("input[type='color']")).toHaveValue('#1e3a8a');
  await expect.poll(() => accent(page)).not.toBe(originalAccent);

  await dialog.getByLabel('Red').fill('126');
  await dialog.getByLabel('Green').fill('34');
  await dialog.getByLabel('Blue').fill('206');
  await expect(hex).toHaveValue('#7E22CE');
  await expect(dialog.locator("input[type='color']")).toHaveValue('#7e22ce');

  await setNative(dialog, '#1e3a8a');
  await expect(hex).toHaveValue('#1E3A8A');
  await expect(dialog.getByLabel('Red')).toHaveValue('30');
  await expect(dialog.getByLabel('Green')).toHaveValue('58');
  await expect(dialog.getByLabel('Blue')).toHaveValue('138');

  await dialog.getByRole('button', { name: 'Pick from screen', exact: true }).click();
  await expect(hex).toHaveValue('#DC2626');
  await expect(dialog.getByLabel('Red')).toHaveValue('220');
  await expect(dialog.getByLabel('Green')).toHaveValue('38');
  await expect(dialog.getByLabel('Blue')).toHaveValue('38');
  await expect(dialog.locator("input[type='color']")).toHaveValue('#dc2626');

  const beforeInvalid = await accent(page);
  await hex.fill('#12');
  await expect.poll(() => accent(page)).toBe(beforeInvalid);
  await expect(dialog.getByText('Enter a valid 3- or 6-digit HEX color.')).toBeVisible();
  await hex.fill('#1E3A8A');
  const beforeInvalidRgb = await accent(page);
  await dialog.getByLabel('Red').fill('999');
  await expect.poll(() => accent(page)).toBe(beforeInvalidRgb);

  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => {
    delete (window as Window & { EyeDropper?: unknown }).EyeDropper;
  });
  dialog = await openDialog(page, 'Demo Worker One');
  await expect(dialog.getByRole('button', { name: 'Pick from screen', exact: true })).toBeDisabled();
});

test('backdrop dismissal restores saved or default draft and saving blocks dismissal', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');
  await enterActiveOrders(page);

  let dialog = await openDialog(page, 'Demo Worker One');
  await setNative(dialog, '#1e3a8a');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  const savedBlue = await accent(page);

  dialog = await openDialog(page, 'Demo Worker One');
  await setNative(dialog, '#7e22ce');
  await expect.poll(() => accent(page)).not.toBe(savedBlue);
  await page.locator('.system-color-dialog-backdrop').click({ position: { x: 2, y: 2 } });
  await expect(dialog).toBeHidden();
  await expect.poll(() => accent(page)).toBe(savedBlue);

  dialog = await openDialog(page, 'Demo Worker One');
  await dialog.getByRole('button', { name: 'Reset to TUX default', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  const defaultAccent = await accent(page);
  dialog = await openDialog(page, 'Demo Worker One');
  await setNative(dialog, '#7e22ce');
  await page.locator('.system-color-dialog-backdrop').click({ position: { x: 2, y: 2 } });
  await expect(dialog).toBeHidden();
  await expect.poll(() => accent(page)).toBe(defaultAccent);

  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as Window & { __releasePreferencePut?: () => void; __restorePreferencePut?: () => void }).__restorePreferencePut = () => {
      IDBObjectStore.prototype.put = original;
    };
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (typeof value === 'object' && value !== null && 'accentColor' in value && (value as { accentColor?: unknown }).accentColor === '#1E3A8A') {
        let success: EventListener | null = null;
        const fake = {
          result: undefined,
          error: null,
          addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
            if (type === 'success') success = typeof listener === 'function' ? listener : listener.handleEvent.bind(listener);
          },
        } as unknown as IDBRequest<IDBValidKey>;
        (window as Window & { __releasePreferencePut?: () => void }).__releasePreferencePut = () => success?.(new Event('success'));
        return fake;
      }
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    };
  });
  dialog = await openDialog(page, 'Demo Worker One');
  await setNative(dialog, '#1e3a8a');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Saving…', exact: true })).toBeVisible();
  await page.locator('.system-color-dialog-backdrop').click({ position: { x: 2, y: 2 } });
  await expect(dialog).toBeVisible();
  await page.evaluate(() => (window as Window & { __releasePreferencePut?: () => void }).__releasePreferencePut?.());
  await expect(dialog).toBeHidden();
  await page.evaluate(() => (window as Window & { __restorePreferencePut?: () => void }).__restorePreferencePut?.());
});

test('worker change closes and discards the previous worker color transaction', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');
  await enterActiveOrders(page);
  let dialog = await openDialog(page, 'Demo Worker One');
  await setNative(dialog, '#1e3a8a');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  const savedBlue = await accent(page);

  dialog = await openDialog(page, 'Demo Worker One');
  await setNative(dialog, '#7e22ce');
  await expect.poll(() => accent(page)).not.toBe(savedBlue);
  await switchWorker(page, 'Demo Worker One', '5678', 'Demo Worker Two', true);
  await expect(dialog).toBeHidden();
  await expect(page.locator('html')).not.toHaveAttribute('data-tux-custom-accent', 'true');
  await switchWorker(page, 'Demo Worker Two', '1234', 'Demo Worker One');
  await expect.poll(() => accent(page)).toBe(savedBlue);
});

test('late remote preferences update the active UI without reload and worker switches queue the newest identity', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');
  const bundle = minimalConfiguration();
  await page.route('**/api/device-session', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ shopId: SHOP, deviceId: '90000000-0000-4000-8000-000000000001' }) });
  });
  await page.route('**/api/operations-config**', async (route) => {
    const url = new URL(route.request().url());
    const body = url.searchParams.has('version') ? { version: 1, bundle } : { version: 1 };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  type Pending = { readonly workerId: string; readonly release: (accentColor: string | null, version: number) => Promise<void> };
  const pending: Pending[] = [];
  await page.route('**/api/worker-ui-preferences**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET') {
      await route.fulfill({ status: 500, body: 'Unexpected preference mutation' });
      return;
    }
    const workerId = url.searchParams.get('workerId') ?? '';
    await new Promise<void>((resolve) => {
      pending.push({
        workerId,
        release: async (accentColor, version) => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              shopId: SHOP,
              workerId,
              categoryOrder: [],
              categoryAlignment: 'left',
              productOrder: [],
              accentColor,
              serverVersion: version,
              updatedAt: `2026-08-29T10:0${version}:00.000Z`,
            }),
          });
          resolve();
        },
      });
    });
  });

  await enterActiveOrders(page, REMOTE_ORIGIN);
  const defaultAccent = await accent(page);
  await expect.poll(() => pending.filter((item) => item.workerId === WORKER_A).length).toBe(1);
  await pending.shift()!.release('#1E3A8A', 2);
  await expect(page.locator('html')).toHaveAttribute('data-tux-custom-accent', 'true');
  const remoteBlue = await accent(page);
  expect(remoteBlue).not.toBe(defaultAccent);

  let dialog = await openDialog(page, 'Demo Worker One');
  await setNative(dialog, '#7e22ce');
  const visibleDraft = await accent(page);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => pending.length).toBe(1);
  await pending[0]!.release('#DC2626', 3);
  pending.shift();
  await expect.poll(() => accent(page)).toBe(visibleDraft);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  const latestRemoteA = await accent(page);
  expect(latestRemoteA).not.toBe(visibleDraft);

  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => pending.length).toBe(1);
  expect(pending[0]!.workerId).toBe(WORKER_A);
  await switchWorker(page, 'Demo Worker One', '5678', 'Demo Worker Two');
  await pending[0]!.release('#1E3A8A', 4);
  pending.shift();
  await expect.poll(() => pending.some((item) => item.workerId === WORKER_B)).toBe(true);
  const requestB = pending.find((item) => item.workerId === WORKER_B)!;
  await requestB.release('#7E22CE', 5);
  pending.splice(pending.indexOf(requestB), 1);
  const workerBAccent = await accent(page);
  expect(workerBAccent).not.toBe(latestRemoteA);
  await expect(page.getByRole('button', { name: /Demo Worker Two/ })).toBeVisible();
});
