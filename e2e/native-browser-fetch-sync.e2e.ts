import { resolve } from 'node:path';
import { build } from 'esbuild';
import { expect, test } from '@playwright/test';
import {
  instant,
  operationsSyncPayloadJson,
  parseEntityId,
  type BusinessDayId,
  type OutboxEvent,
  type OutboxEventId,
  type ShopId,
  type WorkerId,
} from '@tux/domain';

const SHOP_ID = parseEntityId<ShopId>('12000000-0000-4000-8000-000000000001');
const EVENT_ID = parseEntityId<OutboxEventId>('22000000-0000-4000-8000-000000000001');
const DAY_ID = parseEntityId<BusinessDayId>('32000000-0000-4000-8000-000000000001');
const WORKER_ID = parseEntityId<WorkerId>('42000000-0000-4000-8000-000000000001');

const event: OutboxEvent = {
  id: EVENT_ID,
  shopId: SHOP_ID,
  businessDayId: DAY_ID,
  aggregateType: 'BUSINESS_DAY',
  aggregateId: DAY_ID,
  aggregateRevision: 0,
  eventType: 'BUSINESS_DAY_STARTED',
  idempotencyKey: 'chromium-sync-browser-fetch-fixture',
  payloadVersion: 1,
  payload: operationsSyncPayloadJson({
    eventType: 'BUSINESS_DAY_STARTED',
    version: 1,
    businessDay: {
      id: DAY_ID,
      shopId: SHOP_ID,
      status: 'OPEN',
      startedAt: instant('2026-10-24T10:00:00.000Z'),
      endedAt: null,
      startedByWorkerId: WORKER_ID,
      endedByWorkerId: null,
      lastAllocatedDisplayOrderNo: 0,
    },
  }),
  createdAt: instant('2026-10-24T10:00:00.000Z'),
  attemptCount: 0,
  nextAttemptAt: null,
  lastError: null,
  deliveredAt: null,
};

test('native Chromium fetch delivers canonical outbox POST and honors APPLIED/REPLAY', async ({
  page,
}) => {
  // Bundle the actual production transport and its dependencies for a browser execution,
  // rather than reproducing the bug with a synthetic copy of the implementation.
  const bundled = await build({
    entryPoints: [resolve('packages/sync/src/httpTransport.ts')],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'TuxNativeSyncProbe',
    target: 'es2022',
    write: false,
  });
  const source = bundled.outputFiles[0]?.text;
  expect(source).toBeTruthy();

  const requests: Array<{ method: string; url: string; eventId: string | undefined; body: unknown }> = [];
  await page.route('**/__tux_native_sync_probe__', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Native Sync</title>' }),
  );
  await page.route('**/api/operations-sync', async (route) => {
    const request = route.request();
    requests.push({
      method: request.method(),
      url: request.url(),
      eventId: request.headers()['x-tux-event-id'],
      body: request.postDataJSON(),
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: requests.length === 1 ? 'APPLIED' : 'REPLAY' }),
    });
  });

  await page.goto('/__tux_native_sync_probe__');
  await page.addScriptTag({ content: source! });
  await page.evaluate(async (outbox) => {
    const modules = (window as unknown as {
      TuxNativeSyncProbe: {
        HttpOutboxTransport: new (options: { endpoint: string }) => {
          deliver(event: OutboxEvent): Promise<void>;
        };
      };
    }).TuxNativeSyncProbe;
    const transport = new modules.HttpOutboxTransport({
      endpoint: `${location.origin}/api/operations-sync`,
    });
    await transport.deliver(outbox);
    await transport.deliver(outbox);
  }, event);

  expect(requests).toHaveLength(2);
  for (const request of requests) {
    expect(request.method).toBe('POST');
    expect(request.url).toBe('http://127.0.0.1:4173/api/operations-sync');
    expect(request.eventId).toBe(EVENT_ID);
    expect(request.body).toMatchObject({
      eventId: EVENT_ID,
      shopId: SHOP_ID,
      idempotencyKey: event.idempotencyKey,
      eventType: 'BUSINESS_DAY_STARTED',
    });
  }
});
