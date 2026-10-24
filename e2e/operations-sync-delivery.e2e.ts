import { pbkdf2Sync } from 'node:crypto';
import { expect, test, type Route } from '@playwright/test';
import { createOrderStore } from '../apps/admin/api/admin/orders';
import type { AdminSupabaseClient } from '../apps/admin/server/supabaseAdmin';
import { buildRemoteMaterializationPlanV1 } from '../packages/sync/src/remoteMaterializer';
import {
  SHOP,
  WORKER,
  enterActiveOrders,
  minimalConfiguration,
  prepareRenderedOrderControls,
} from './worker-system-color-test-helpers';

const REMOTE_ORIGIN = 'https://tux.localhost:4173';
const LOOPBACK_ORIGIN = 'http://127.0.0.1:4173';
const DEVICE_ID = '50000000-0000-4000-8000-000000000001';
const BUSINESS_ID = '60000000-0000-4000-8000-000000000001';

function workerPinHash(pin: string): string {
  const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const digest = pbkdf2Sync(pin, salt, 210_000, 32, 'sha256');
  return `pbkdf2-sha256$210000$${salt.toString('hex')}$${digest.toString('hex')}`;
}

async function routeRemoteRuntime(
  route: Route,
  capture: { orderRow: Readonly<Record<string, unknown>> | null; orderPosts: number },
): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());

  if (url.pathname === '/api/device-session') {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ shopId: SHOP, deviceId: DEVICE_ID }),
    });
    return;
  }
  if (url.pathname === '/api/operations-config') {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ version: 1, bundle: minimalConfiguration() }),
    });
    return;
  }
  if (url.pathname === '/api/worker-auth' && request.method() === 'POST') {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        worker: {
          id: WORKER,
          shopId: SHOP,
          displayName: 'Demo Worker One',
          pinHash: workerPinHash('1234'),
          active: true,
        },
      }),
    });
    return;
  }
  if (url.pathname === '/api/operations-inventory') {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        shopId: SHOP,
        items: [],
        movements: [],
        costs: [],
        nextCursor: null,
        hasMore: false,
      }),
    });
    return;
  }
  if (url.pathname === '/api/operations-order-lifecycle') {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ shopId: SHOP, events: [], nextCursor: null, hasMore: false }),
    });
    return;
  }
  if (url.pathname === '/api/online-order-operations') {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ schemaVersion: 1, requests: [] }),
    });
    return;
  }
  if (url.pathname === '/api/operations-sync' && request.method() === 'POST') {
    const envelope = request.postDataJSON();
    const plan = buildRemoteMaterializationPlanV1(envelope);
    const orderMutation = plan.mutations.find((mutation) => mutation.table === 'orders');
    if (orderMutation !== undefined) {
      capture.orderPosts += 1;
      capture.orderRow = orderMutation.row;
      expect(request.headers()['x-tux-event-id']).toBe(envelope.eventId);
      expect(request.headers()['x-tux-idempotency-key']).toBe(envelope.idempotencyKey);
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'APPLIED' }),
    });
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    return;
  }

  const response = await route.fetch({ url: `${LOOPBACK_ORIGIN}${url.pathname}${url.search}` });
  await route.fulfill({ response });
}

test('Chromium delivers a locally created Order and exposes its canonical Admin row', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');
  const capture: {
    orderRow: Readonly<Record<string, unknown>> | null;
    orderPosts: number;
  } = { orderRow: null, orderPosts: 0 };
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.route(`${REMOTE_ORIGIN}/**`, (route) => routeRemoteRuntime(route, capture));

  await enterActiveOrders(page, REMOTE_ORIGIN);
  await prepareRenderedOrderControls(page);
  await page.getByRole('button', { name: 'Place Order', exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));

  await expect.poll(() => capture.orderPosts, { timeout: 20_000 }).toBe(1);
  await expect(page.locator('[data-state="SYNCED"]')).toBeVisible();
  const pendingCount = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('tux-operations-v2');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          const transaction = database.transaction('outboxEvents', 'readonly');
          const all = transaction.objectStore('outboxEvents').getAll();
          all.onerror = () => reject(all.error);
          all.onsuccess = () => {
            resolve(
              (all.result as Array<{ deliveredAt: string | null }>).filter(
                (event) => event.deliveredAt === null,
              ).length,
            );
            database.close();
          };
        };
      }),
  );
  expect(pendingCount).toBe(0);

  const select = async (table: string) => {
    if (table === 'business_shops') return [{ shop_id: SHOP }];
    if (table === 'orders') return [capture.orderRow];
    throw new Error(`unexpected_table:${table}`);
  };
  const adminOrders = createOrderStore({ select } as unknown as AdminSupabaseClient);
  const result = await adminOrders.searchOrders({
    shopId: SHOP,
    businessId: BUSINESS_ID,
    employeeId: '70000000-0000-4000-8000-000000000001',
    limit: 50,
  });
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({
    id: capture.orderRow?.['id'],
    shopId: SHOP,
    status: 'ACTIVE',
    source: 'POS',
    displayOrderLabel: '#1',
  });
  expect(consoleErrors).toEqual([]);

  await page.screenshot({
    path: testInfo.outputPath('operations-order-delivered-and-synced.png'),
    animations: 'disabled',
    caret: 'hide',
    fullPage: false,
  });
});
