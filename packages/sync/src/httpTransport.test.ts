import { afterEach, describe, expect, it, vi } from 'vitest';
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
import { HttpInventoryFeedTransport } from './inventoryConvergence';
import { HttpOrderLifecycleFeedTransport } from './orderLifecycleConvergence';
import type { OutboxDeliveryError } from './outboxSync';

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HttpOutboxTransport', () => {
  it('uses the window receiver for native fetch while preserving APPLIED and REPLAY receipts', async () => {
    const requests: Array<{ url: string; method: string }> = [];
    function browserFetch(
      this: typeof globalThis,
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      requests.push({ url: String(input), method: init?.method ?? 'GET' });
      const status = requests.length === 1 ? 'APPLIED' : 'REPLAY';
      return Promise.resolve(new Response(JSON.stringify({ status }), { status: 200 }));
    }
    vi.stubGlobal('fetch', browserFetch);

    try {
      const transport = new HttpOutboxTransport({
        endpoint: 'https://sync.example.test/api/operations-sync',
      });
      await transport.deliver(event);
      await transport.deliver(event);
      expect(requests).toEqual([
        { url: 'https://sync.example.test/api/operations-sync', method: 'POST' },
        { url: 'https://sync.example.test/api/operations-sync', method: 'POST' },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses the browser fetch receiver for inventory and lifecycle GET convergence', async () => {
    const requests: Array<{ url: string; method: string }> = [];
    function browserFetch(
      this: typeof globalThis,
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      const url = String(input);
      requests.push({ url, method: init?.method ?? 'GET' });
      const responseBody = url.includes('inventory')
        ? { shopId: SHOP_ID, items: [], movements: [], costs: [], nextCursor: null, hasMore: false }
        : { shopId: SHOP_ID, events: [], nextCursor: null, hasMore: false };
      return Promise.resolve(new Response(JSON.stringify(responseBody), { status: 200 }));
    }
    vi.stubGlobal('fetch', browserFetch);

    try {
      const inventory = new HttpInventoryFeedTransport({
        endpoint: 'https://sync.example.test/api/operations-inventory',
      });
      const lifecycle = new HttpOrderLifecycleFeedTransport({
        endpoint: 'https://sync.example.test/api/operations-order-lifecycle',
      });
      expect((await inventory.pull(SHOP_ID, null)).items).toEqual([]);
      expect((await lifecycle.pull(SHOP_ID, null)).events).toEqual([]);
      expect(requests).toHaveLength(2);
      expect(requests.every((request) => request.method === 'GET')).toBe(true);
      expect(requests.every((request) => request.url.includes('shopId='))).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('invokes the default browser fetch with the global receiver', async () => {
    const nativeFetch = vi.fn(function (this: unknown) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(
        new Response(JSON.stringify({ status: 'APPLIED' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', nativeFetch);
    const transport = new HttpOutboxTransport({ endpoint: 'https://sync.example.test/events' });

    await expect(transport.deliver(event)).resolves.toBeUndefined();
  });

  it('sends immutable event identity and idempotency headers', async () => {
    const calls: Array<Parameters<typeof fetch>> = [];
    const fetcher: typeof fetch = async (...args) => {
      calls.push(args);
      return new Response(JSON.stringify({ status: 'APPLIED' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
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

  it('resolves authorization headers per delivery so refreshed device JWTs are used', async () => {
    const calls: Array<Parameters<typeof fetch>> = [];
    let tokenRevision = 0;
    const fetcher: typeof fetch = async (...args) => {
      calls.push(args);
      return new Response(JSON.stringify({ status: calls.length === 1 ? 'APPLIED' : 'REPLAY' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const transport = new HttpOutboxTransport({
      endpoint: 'https://sync.example.test/events',
      headerProvider: async () => ({ authorization: `Bearer token-${++tokenRevision}` }),
      fetcher,
    });

    await transport.deliver(event);
    await transport.deliver(event);

    expect((calls[0]?.[1]?.headers as Record<string, string>)['authorization']).toBe(
      'Bearer token-1',
    );
    expect((calls[1]?.[1]?.headers as Record<string, string>)['authorization']).toBe(
      'Bearer token-2',
    );
  });

  it('does not accept non-2xx responses as delivered', async () => {
    const transport = new HttpOutboxTransport({
      endpoint: 'https://sync.example.test/events',
      fetcher: (async () => new Response(null, { status: 503 })) as typeof fetch,
    });
    await expect(transport.deliver(event)).rejects.toThrow(/HTTP 503/);
  });

  it.each([
    ['an empty response', new Response(null, { status: 204 })],
    [
      'malformed JSON',
      new Response('not-json', { status: 200, headers: { 'content-type': 'application/json' } }),
    ],
    [
      'an unknown receipt',
      new Response(JSON.stringify({ status: 'QUEUED' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ],
  ])('keeps delivery retryable when a 2xx has %s', async (_label, response) => {
    const transport = new HttpOutboxTransport({
      endpoint: 'https://sync.example.test/events',
      fetcher: (async () => response.clone()) as typeof fetch,
    });

    await expect(transport.deliver(event)).rejects.toMatchObject({
      kind: 'TRANSIENT',
      status: response.status,
    } satisfies Partial<OutboxDeliveryError>);
  });

  it.each([401, 403])(
    'keeps HTTP %s authentication failures retryable so queued orders are not quarantined',
    async (status) => {
      const transport = new HttpOutboxTransport({
        endpoint: 'https://sync.example.test/events',
        fetcher: (async () => new Response(null, { status })) as typeof fetch,
      });

      await expect(transport.deliver(event)).rejects.toMatchObject({
        kind: 'TRANSIENT',
        status,
      } satisfies Partial<OutboxDeliveryError>);
    },
  );

  it.each([
    [423, 'business_day_open_conflict', 'Canonical Business Day'],
    [425, 'business_day_dependency_not_ready', 'Business Day'],
  ])(
    'retains blocked day events on HTTP %i with actionable diagnostics',
    async (status, code, expected) => {
      const transport = new HttpOutboxTransport({
        endpoint: 'https://sync.example.test/events',
        fetcher: (async () =>
          new Response(
            JSON.stringify({
              error: code,
              canonicalDayId: DAY_ID,
              missingDayId: DAY_ID,
            }),
            { status },
          )) as typeof fetch,
      });
      await expect(transport.deliver(event)).rejects.toMatchObject({
        kind: 'TRANSIENT',
        status,
        message: expect.stringContaining(expected),
      } satisfies Partial<OutboxDeliveryError>);
    },
  );

  it('requests recovery of the exact missing Business Day start before retrying a 425', async () => {
    const recovered: string[] = [];
    const transport = new HttpOutboxTransport({
      endpoint: 'https://sync.example.test/events',
      onDependencyMissing: async (_event, businessDayId) => {
        recovered.push(businessDayId);
      },
      fetcher: (async () =>
        new Response(
          JSON.stringify({ error: 'business_day_dependency_not_ready', missingDayId: DAY_ID }),
          { status: 425 },
        )) as typeof fetch,
    });

    await expect(transport.deliver(event)).rejects.toMatchObject({
      kind: 'TRANSIENT',
      status: 425,
    });
    expect(recovered).toEqual([DAY_ID]);
  });

  it('quarantines explicit permanent day identity conflicts with their actionable cause', async () => {
    const transport = new HttpOutboxTransport({
      endpoint: 'https://sync.example.test/events',
      fetcher: (async () =>
        new Response(JSON.stringify({ error: 'business_day_identity_conflict' }), {
          status: 409,
        })) as typeof fetch,
    });
    await expect(transport.deliver(event)).rejects.toMatchObject({
      kind: 'PERMANENT',
      status: 409,
      message: expect.stringContaining('explicit, audited recovery'),
    } satisfies Partial<OutboxDeliveryError>);
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
