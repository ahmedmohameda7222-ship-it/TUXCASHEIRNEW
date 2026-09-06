import { pbkdf2Sync } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const SHOP = '10000000-0000-4000-8000-000000000001';
const WORKER = '20000000-0000-4000-8000-000000000001';
const DATABASE = 'tux-operations-v2';
const DRAFT_DATABASE = 'tux-operations-v2-drafts';
const CONVERSATION = 'a0000000-0000-4000-8000-000000000001';

function pinHash(pin: string): string {
  const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const digest = pbkdf2Sync(pin, salt, 210_000, 32, 'sha256');
  return `pbkdf2-sha256$210000$${salt.toString('hex')}$${digest.toString('hex')}`;
}

async function seedBrowserFallback(page: Page): Promise<void> {
  await page.route('**/__tux_whatsapp_e2e_seed__', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>seed</title>',
    });
  });
  await page.goto('/__tux_whatsapp_e2e_seed__');
  await page.evaluate(
    async ({ databaseName, draftDatabaseName, shopId, workerId, workerPinHash }) => {
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

      const categoryId = '30000000-0000-4000-8000-000000000001';
      const productId = '40000000-0000-4000-8000-000000000001';
      const orderTypeId = '70000000-0000-4000-8000-000000000001';
      const paymentMethodId = '80000000-0000-4000-8000-000000000001';
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(
          ['shops', 'workers', 'configurationSnapshots'],
          'readwrite',
        );
        tx.objectStore('shops').put({ id: shopId, name: 'TUX WhatsApp E2E', active: true });
        tx.objectStore('workers').put({
          id: workerId,
          shopId,
          displayName: 'WhatsApp E2E Worker',
          pinHash: workerPinHash,
          active: true,
        });
        tx.objectStore('configurationSnapshots').put({
          shopId,
          version: 1,
          updatedAt: '2026-09-06T00:00:00.000Z',
          categories: [{ id: categoryId, shopId, name: 'Burgers', sortOrder: 0, active: true }],
          products: [
            {
              id: productId,
              shopId,
              categoryId,
              name: 'E2E Burger',
              description: null,
              priceMinor: 10_000,
              imageKey: null,
              active: true,
              soldOut: false,
              family: null,
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
              id: orderTypeId,
              shopId,
              name: 'Take Away',
              behavior: 'TAKE_AWAY',
              sortOrder: 0,
              active: true,
            },
          ],
          paymentMethods: [
            {
              id: paymentMethodId,
              shopId,
              displayName: 'Cash',
              logicType: 'CASH',
              requiresReconciliation: true,
              sortOrder: 0,
              active: true,
            },
          ],
          deliveryZones: [],
        });
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
    },
  );
  await page.unroute('**/__tux_whatsapp_e2e_seed__');
}

async function enterActiveShell(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByText('No active Business Day')).toBeVisible();
  await page.getByLabel('Enter PIN to Start Day').fill('1234');
  await page.getByRole('button', { name: 'Start Day' }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('.welcome-action') !== null ||
      document.querySelector('[aria-label="Operations"]') !== null,
  );
  const continueButton = page.locator('.welcome-action');
  if (await continueButton.isVisible().catch(() => false)) await continueButton.click();
  await expect(page.getByRole('navigation', { name: 'Operations' })).toBeVisible({
    timeout: 15_000,
  });
}

test('inbound unread opens and explicit reply sends exactly once', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');
  await seedBrowserFallback(page);

  const inboxResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/whatsapp',
  );
  await enterActiveShell(page);

  const inboxResponse = await inboxResponsePromise;
  expect(inboxResponse.status()).toBe(200);
  expect(inboxResponse.headers()['content-type']).toContain('application/json');
  await expect(inboxResponse.json()).resolves.toMatchObject({
    conversations: [
      {
        id: CONVERSATION,
        customerName: 'E2E Customer',
        unreadCount: 1,
      },
    ],
  });

  await page.getByRole('button', { name: /^WhatsApp\b/ }).click();
  const conversation = page.locator(`[data-conversation-id="${CONVERSATION}"]`);
  await expect(conversation).toContainText('E2E Customer');
  await conversation.click();
  await expect(page.getByLabel('Message history')).toContainText('Can I order?');

  await page.getByLabel('Message').fill('Yes — what would you like?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByLabel('Message history')).toContainText('Yes — what would you like?');

  const counters = await page.request.get('/__tux_whatsapp_assertions__');
  expect(counters.ok()).toBe(true);
  await expect(counters.json()).resolves.toMatchObject({ sendMessage: 1 });
});
