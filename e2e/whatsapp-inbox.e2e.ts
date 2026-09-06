import { pbkdf2Sync } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const SHOP = '10000000-0000-4000-8000-000000000001';
const WORKER = '20000000-0000-4000-8000-000000000001';
const DATABASE = 'tux-operations-v2';
const DRAFT_DATABASE = 'tux-operations-v2-drafts';
const CONVERSATION = 'a0000000-0000-4000-8000-000000000001';
const STOREFRONT_URL = 'https://menu.tux.example';
const STARTER_TEMPLATE_LABEL = 'Order follow-up';

type WhatsAppE2ePolicy = 'FREE_FORM' | 'TEMPLATE_ONLY' | 'BLOCKED';

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

async function configureWhatsAppScenario(page: Page, policy: WhatsAppE2ePolicy): Promise<void> {
  const response = await page.request.post('/__tux_whatsapp_control__', {
    data: { policy, reset: true },
  });
  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toEqual({ ok: true, policy });
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

async function seedActiveDeliveryOrders(
  page: Page,
  displayOrderNos: readonly number[],
): Promise<readonly string[]> {
  return page.evaluate(
    async ({ databaseName, shopId, workerId, orderNos }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const day = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const tx = database.transaction('businessDays', 'readonly');
        const request = tx.objectStore('businessDays').index('shopStatus').get([shopId, 'OPEN']);
        request.onsuccess = () => {
          if (request.result === undefined) reject(new Error('Open Business Day not found.'));
          else resolve(request.result as Record<string, unknown>);
        };
        request.onerror = () => reject(request.error);
      });
      const businessDayId = String(day['id']);
      const ids = orderNos.map(
        (orderNo) => `d0000000-0000-4000-8000-${String(orderNo).padStart(12, '0')}`,
      );
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(['businessDays', 'orders'], 'readwrite');
        const orders = tx.objectStore('orders');
        for (const [index, orderNo] of orderNos.entries()) {
          orders.put({
            id: ids[index],
            shopId,
            businessDayId,
            displayOrderNo: orderNo,
            idempotencyKey: `whatsapp-e2e-order-${orderNo}`,
            status: 'ACTIVE',
            source: 'POS',
            operatorWorkerId: workerId,
            operatorName: 'WhatsApp E2E Worker',
            createdAt: `2026-09-06T00:${String(index + 1).padStart(2, '0')}:00.000Z`,
            fulfillment: {
              orderTypeId: '70000000-0000-4000-8000-000000000003',
              orderTypeLabel: 'Delivery',
              behavior: 'DELIVERY',
              delivery: {
                customerContactId: null,
                customerName: 'E2E Customer',
                normalizedPhone: '+201001234567',
                address: 'E2E Address',
                zoneId: '90000000-0000-4000-8000-000000000001',
                zoneLabel: 'E2E Zone',
                configuredFeeMinor: 0,
                finalFeeMinor: 0,
              },
            },
            items: [
              {
                id: `e0000000-0000-4000-8000-${String(orderNo).padStart(12, '0')}`,
                productId: '40000000-0000-4000-8000-000000000001',
                productName: 'E2E Burger',
                unitPriceMinor: 10_000,
                quantity: 1,
                modifiers: [],
                comboBeverages: [],
                itemNote: null,
              },
            ],
            orderNote: null,
            itemsSubtotalMinor: 10_000,
            discountMinor: 0,
            deliveryFeeMinor: 0,
            totalMinor: 10_000,
            payments: [
              {
                id: `f0000000-0000-4000-8000-${String(orderNo).padStart(12, '0')}`,
                method: {
                  id: '80000000-0000-4000-8000-000000000001',
                  label: 'Cash',
                  logicType: 'CASH',
                },
                allocatedMinor: 10_000,
                receivedMinor: 10_000,
                changeMinor: 0,
              },
            ],
          });
        }
        const highest = Math.max(Number(day['lastAllocatedDisplayOrderNo'] ?? 0), ...orderNos);
        tx.objectStore('businessDays').put({ ...day, lastAllocatedDisplayOrderNo: highest });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      database.close();
      return ids;
    },
    {
      databaseName: DATABASE,
      shopId: SHOP,
      workerId: WORKER,
      orderNos: [...displayOrderNos],
    },
  );
}

async function openWhatsAppConversation(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Operations' })
    .getByRole('button', { name: /^WhatsApp\b/ })
    .click();
  const conversation = page.locator(`[data-conversation-id="${CONVERSATION}"]`);
  await expect(conversation).toContainText('E2E Customer');
  await conversation.click();
  await expect(page.getByLabel('Message history')).toContainText('Can I order?');
}

test('inbound unread opens and explicit reply sends exactly once', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');
  await configureWhatsAppScenario(page, 'FREE_FORM');
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

  await openWhatsAppConversation(page);
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('Yes — what would you like?');
  const sendResponsePromise = page.waitForResponse((response) => {
    if (response.request().method() !== 'POST') return false;
    if (new URL(response.url()).pathname !== '/api/whatsapp') return false;
    return response.request().postData()?.includes('SEND_MESSAGE') === true;
  });
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const sendResponse = await sendResponsePromise;
  expect(sendResponse.status()).toBe(200);
  expect(sendResponse.request().postDataJSON()).toMatchObject({
    action: 'SEND_MESSAGE',
    workerId: WORKER,
    conversationId: CONVERSATION,
  });
  await expect(sendResponse.json()).resolves.toMatchObject({
    message: { sentByWorkerId: WORKER },
  });
  await expect(page.getByLabel('Message history')).toContainText('Yes — what would you like?');

  const counters = await page.request.get('/__tux_whatsapp_assertions__');
  expect(counters.ok()).toBe(true);
  await expect(counters.json()).resolves.toMatchObject({ sendMessage: 1 });
});

test('one active delivery order is shown directly', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');
  await configureWhatsAppScenario(page, 'FREE_FORM');
  await seedBrowserFallback(page);
  await enterActiveShell(page);
  await seedActiveDeliveryOrders(page, [41]);
  await openWhatsAppConversation(page);

  const context = page.getByLabel('Customer and order context');
  await expect(context).toContainText('Order #41');
  await expect(context).toContainText('Delivery');
  await expect(context).toContainText('Not linked');
  await expect(context.getByText('Choose an order explicitly')).toHaveCount(0);
});

test('multiple active orders require explicit link selection', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');
  await configureWhatsAppScenario(page, 'FREE_FORM');
  await seedBrowserFallback(page);
  await enterActiveShell(page);
  const [, selectedOrderId] = await seedActiveDeliveryOrders(page, [41, 42]);
  await openWhatsAppConversation(page);

  const context = page.getByLabel('Customer and order context');
  await expect(context.getByText('Choose an order explicitly')).toBeVisible();
  await expect(context.getByText('Order #41')).toBeVisible();
  await expect(context.getByText('Order #42')).toBeVisible();

  const selectedOrder = context.getByText('Order #42').locator('..').locator('..');
  const linkResponsePromise = page.waitForResponse((response) => {
    if (response.request().method() !== 'POST') return false;
    if (new URL(response.url()).pathname !== '/api/whatsapp') return false;
    return response.request().postData()?.includes('LINK_ORDER') === true;
  });
  await selectedOrder.getByRole('button', { name: 'Link', exact: true }).click();
  const linkResponse = await linkResponsePromise;
  expect(linkResponse.status()).toBe(200);
  expect(linkResponse.request().postDataJSON()).toMatchObject({
    action: 'LINK_ORDER',
    workerId: WORKER,
    conversationId: CONVERSATION,
    orderId: selectedOrderId,
    linked: true,
  });
});

test('FREE_FORM Send Menu inserts canonical URL without auto-send', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');
  await configureWhatsAppScenario(page, 'FREE_FORM');
  await seedBrowserFallback(page);
  await enterActiveShell(page);
  await openWhatsAppConversation(page);

  await page.getByRole('button', { name: 'Send Menu', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
    `منيو TUX 👇\n${STOREFRONT_URL}`,
  );

  const counters = await page.request.get('/__tux_whatsapp_assertions__');
  await expect(counters.json()).resolves.toMatchObject({ sendMessage: 0, sendTemplate: 0 });
});

test('TEMPLATE_ONLY renders and sends starter template once', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');
  await configureWhatsAppScenario(page, 'TEMPLATE_ONLY');
  await seedBrowserFallback(page);
  await enterActiveShell(page);
  await openWhatsAppConversation(page);

  const composer = page.locator('[data-whatsapp-policy="TEMPLATE_ONLY"]');
  await expect(composer).toBeVisible();
  await expect(composer.getByText('The free-form messaging window is closed.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Saved draft', exact: true })).toBeDisabled();

  const templateResponse = page.waitForResponse((response) => {
    if (response.request().method() !== 'POST') return false;
    if (new URL(response.url()).pathname !== '/api/whatsapp') return false;
    return response.request().postData()?.includes('SEND_TEMPLATE') === true;
  });
  await page.getByRole('button', { name: new RegExp(STARTER_TEMPLATE_LABEL) }).click();
  expect((await templateResponse).status()).toBe(200);

  const counters = await page.request.get('/__tux_whatsapp_assertions__');
  await expect(counters.json()).resolves.toMatchObject({ sendMessage: 0, sendTemplate: 1 });
});

test('BLOCKED preserves history without outbound actions', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');
  await configureWhatsAppScenario(page, 'BLOCKED');
  await seedBrowserFallback(page);
  await enterActiveShell(page);
  await openWhatsAppConversation(page);

  const composer = page.locator('[data-whatsapp-policy="BLOCKED"]');
  await expect(composer).toBeVisible();
  await expect(composer.getByText('Messaging unavailable')).toBeVisible();
  await expect(page.getByLabel('Message history')).toContainText('Can I order?');
  await expect(page.locator('[data-whatsapp-send-menu]')).toHaveCount(0);
  await expect(page.locator('[data-whatsapp-send]')).toHaveCount(0);
  await expect(page.locator('[data-template-id]')).toHaveCount(0);
});
