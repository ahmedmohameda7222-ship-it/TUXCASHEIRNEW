import { describe, expect, it, vi } from 'vitest';
import {
  instant,
  parseEntityId,
  type OutboxEvent,
  type OutboxEventId,
  type ShopId,
} from '@tux/domain';
import { HttpOutboxTransport } from './httpTransport';

const SHOP_ID = parseEntityId<ShopId>('12000000-0000-4000-8000-000000000001');
const EVENT_ID = parseEntityId<OutboxEventId>('22000000-0000-4000-8000-000000000001');
const event: OutboxEvent = {
  id: EVENT_ID,
  shopId: SHOP_ID,
  businessDayId: null,
  aggregateType: 'ORDER',
  aggregateId: 'order-fixture',
  eventType: 'ORDER_PLACED',
  idempotencyKey: 'order-placed:fixture',
  payloadVersion: 1,
  payload: { orderId: 'fixture' },
  createdAt: instant('2026-08-18T10:00:00.000Z'),
  attemptCount: 0,
  nextAttemptAt: null,
  lastError: null,
  deliveredAt: null,
};

describe('HttpOutboxTransport', () => {
  it('sends immutable event identity and idempotency headers', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    const transport = new HttpOutboxTransport({
      endpoint: 'https://sync.example.test/events',
      headers: { authorization: 'Bearer test-only' },
      fetcher: fetcher as typeof fetch,
    });
    await transport.deliver(event);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://sync.example.test/events');
    expect(init?.headers).toMatchObject({
      'x-tux-event-id': EVENT_ID,
      'x-tux-idempotency-key': event.idempotencyKey,
      authorization: 'Bearer test-only',
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      eventId: EVENT_ID,
      idempotencyKey: event.idempotencyKey,
      eventType: 'ORDER_PLACED',
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
