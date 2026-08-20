import { describe, expect, it } from 'vitest';
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
import { HttpOutboxTransport } from './httpTransport';

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
  idempotencyKey: 'business-day-started:fixture',
  payloadVersion: 1,
  payload: operationsSyncPayloadJson({
    eventType: 'BUSINESS_DAY_STARTED',
    version: 1,
    businessDay: {
      id: DAY_ID,
      shopId: SHOP_ID,
      status: 'OPEN',
      startedAt: instant('2026-08-18T10:00:00.000Z'),
      endedAt: null,
      startedByWorkerId: WORKER_ID,
      endedByWorkerId: null,
      lastAllocatedDisplayOrderNo: 0,
    },
  }),
  createdAt: instant('2026-08-18T10:00:00.000Z'),
  attemptCount: 0,
  nextAttemptAt: null,
  lastError: null,
  deliveredAt: null,
};

describe('HttpOutboxTransport', () => {
  it('sends immutable event identity and idempotency headers', async () => {
    const calls: Array<Parameters<typeof fetch>> = [];
    const fetcher: typeof fetch = async (...args) => {
      calls.push(args);
      return new Response(null, { status: 204 });
    };
    const transport = new HttpOutboxTransport({
      endpoint: 'https://sync.example.test/events',
      headers: { authorization: 'Bearer test-only' },
      fetcher,
    });
    await transport.deliver(event);
    const [url, init] = calls[0]!;
    expect(url).toBe('https://sync.example.test/events');
    expect(init?.headers).toMatchObject({
      'x-tux-event-id': EVENT_ID,
      'x-tux-idempotency-key': event.idempotencyKey,
      authorization: 'Bearer test-only',
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      eventId: EVENT_ID,
      idempotencyKey: event.idempotencyKey,
      eventType: 'BUSINESS_DAY_STARTED',
    });
  });

  it('does not accept non-2xx responses as delivered', async () => {
    const transport = new HttpOutboxTransport({
      endpoint: 'https://sync.example.test/events',
      fetcher: (async () => new Response(null, { status: 503 })) as typeof fetch,
    });
    await expect(transport.deliver(event)).rejects.toThrow(/HTTP 503/);
  });

  it('requires HTTPS outside loopback development', () => {
    expect(() => new HttpOutboxTransport({ endpoint: 'http://example.test/events' })).toThrow(
      /HTTPS/,
    );
    expect(
      () => new HttpOutboxTransport({ endpoint: 'http://localhost:8787/events' }),
    ).not.toThrow();
  });
});
