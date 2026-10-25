import 'fake-indexeddb/auto';

import {
  instant,
  parseEntityId,
  type BusinessDayId,
  type OrderId,
  type OutboxEvent,
  type OutboxEventId,
  type ShopId,
} from '@tux/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { IndexedDbOperationsDatabase } from './IndexedDbOperationsDatabase';

const A = parseEntityId<ShopId>('11000000-0000-4000-8000-000000000001');
const B = parseEntityId<ShopId>('11000000-0000-4000-8000-000000000002');
const names = new Set<string>();

function outbox(
  id: string,
  shopId: ShopId,
  eventType: OutboxEvent['eventType'],
  createdAt: string,
  retryAt: string | null = null,
): OutboxEvent {
  return {
    id: parseEntityId<OutboxEventId>(id),
    shopId,
    businessDayId: null,
    aggregateType: 'BUSINESS_DAY',
    aggregateId: '21000000-0000-4000-8000-000000000001',
    aggregateRevision: null,
    eventType,
    idempotencyKey: id,
    payloadVersion: 1,
    payload: { fixture: id },
    createdAt: instant(createdAt),
    attemptCount: retryAt === null ? 0 : 1,
    nextAttemptAt: retryAt === null ? null : instant(retryAt),
    lastError: retryAt === null ? null : 'original day delivery delayed',
    deliveredAt: null,
  };
}

afterEach(async () => {
  for (const name of names) {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }
  names.clear();
});

describe('IndexedDB Business Day outbox ordering', () => {
  it('replays the original order placement before a recovered lifecycle mutation', async () => {
    const name = 'tux-outbox-order-origin-recovery-' + crypto.randomUUID();
    names.add(name);
    const db = new IndexedDbOperationsDatabase(name);
    await db.initialize();
    try {
      const orderId = parseEntityId<OrderId>('31000000-0000-4000-8000-000000000001');
      const origin = {
        ...outbox(
          '33000000-0000-4000-8000-000000000101',
          A,
          'ORDER_PLACED',
          '2026-10-10T08:00:00.000Z',
        ),
        aggregateType: 'ORDER' as const,
        aggregateId: orderId,
        aggregateRevision: 0,
      };
      const lifecycle = {
        ...outbox(
          '33000000-0000-4000-8000-000000000102',
          A,
          'ORDER_MARKED_DONE',
          '2026-10-10T08:05:00.000Z',
        ),
        aggregateType: 'ORDER' as const,
        aggregateId: orderId,
        aggregateRevision: 1,
      };
      await db.transaction(async (tx) => {
        await tx.outbox.append(origin);
        await tx.outbox.markDelivered(origin.id, instant('2026-10-10T08:00:01.000Z'));
        await tx.outbox.append(lifecycle);
        await tx.outbox.quarantine(
          lifecycle.id,
          instant('2026-10-10T08:05:01.000Z'),
          'Remote outbox endpoint rejected event with HTTP 400.',
        );
      });

      await expect(
        db.transaction((tx) => tx.outbox.recoverMissingOrderPlacement(orderId)),
      ).resolves.toBe('RECOVERED');
      await expect(
        db.transaction((tx) => tx.outbox.listPending(instant('2026-10-10T09:00:00.000Z'), 50, A)),
      ).resolves.toEqual([
        expect.objectContaining({
          id: origin.id,
          eventType: 'ORDER_PLACED',
          deliveredAt: null,
          lastError: null,
        }),
      ]);
    } finally {
      await db.close();
    }
  });

  it('exposes the quarantined event identity in delivery diagnostics without deleting it', async () => {
    const name = 'tux-outbox-quarantine-diagnostics-' + crypto.randomUUID();
    names.add(name);
    const db = new IndexedDbOperationsDatabase(name);
    await db.initialize();
    try {
      const event = {
        ...outbox(
          '33000000-0000-4000-8000-000000000001',
          A,
          'BUSINESS_DAY_STARTED',
          '2026-10-10T08:00:00.000Z',
        ),
        businessDayId: parseEntityId<BusinessDayId>('35000000-0000-4000-8000-000000000001'),
      };
      await db.transaction(async (tx) => {
        await tx.outbox.append(event);
        await tx.outbox.quarantine(
          event.id,
          instant('2026-10-10T08:00:01.000Z'),
          'Remote outbox endpoint rejected event with HTTP 400.',
        );
      });

      const status = await db.transaction((tx) => tx.outbox.getDeliveryStatus(A));
      expect(status.pendingCount).toBe(0);
      expect(status.quarantinedCount).toBe(1);
      expect(status.lastError).toContain('BUSINESS_DAY_STARTED');
      expect(status.lastError).toContain(event.id);
      expect(status.lastError).toContain(event.businessDayId);
      expect(
        await db.transaction((tx) =>
          tx.outbox.listPending(instant('2026-10-10T09:00:00.000Z'), 50, A),
        ),
      ).toEqual([]);
    } finally {
      await db.close();
    }
  });

  it('requeues only the quarantined start for the exact missing Business Day', async () => {
    const name = 'tux-outbox-missing-day-recovery-' + crypto.randomUUID();
    names.add(name);
    const db = new IndexedDbOperationsDatabase(name);
    await db.initialize();
    try {
      const missingDayId = parseEntityId<BusinessDayId>('35000000-0000-4000-8000-000000000001');
      const otherDayId = parseEntityId<BusinessDayId>('35000000-0000-4000-8000-000000000002');
      const missing = {
        ...outbox(
          '33000000-0000-4000-8000-000000000011',
          A,
          'BUSINESS_DAY_STARTED',
          '2026-10-10T08:00:00.000Z',
        ),
        businessDayId: missingDayId,
      };
      const other = {
        ...outbox(
          '33000000-0000-4000-8000-000000000012',
          A,
          'BUSINESS_DAY_STARTED',
          '2026-10-10T08:00:01.000Z',
        ),
        businessDayId: otherDayId,
      };
      await db.transaction(async (tx) => {
        await tx.outbox.append(missing);
        await tx.outbox.append(other);
        await tx.outbox.quarantine(
          missing.id,
          instant('2026-10-10T08:01:00.000Z'),
          'legacy HTTP 400',
        );
        await tx.outbox.quarantine(
          other.id,
          instant('2026-10-10T08:01:00.000Z'),
          'unrelated evidence',
        );
      });

      await expect(
        db.transaction((tx) => tx.outbox.recoverMissingBusinessDayStart(missingDayId)),
      ).resolves.toBe('RECOVERED');
      expect(
        (
          await db.transaction((tx) =>
            tx.outbox.listPending(instant('2026-10-10T09:00:00.000Z'), 50, A),
          )
        ).map((event) => event.id),
      ).toEqual([missing.id]);
      expect((await db.transaction((tx) => tx.outbox.getDeliveryStatus(A))).quarantinedCount).toBe(
        1,
      );
    } finally {
      await db.close();
    }
  });

  it('requeues a previously delivered start when the canonical Business Day was reset', async () => {
    const name = 'tux-outbox-reset-day-recovery-' + crypto.randomUUID();
    names.add(name);
    const db = new IndexedDbOperationsDatabase(name);
    await db.initialize();
    try {
      const resetDayId = parseEntityId<BusinessDayId>('35000000-0000-4000-8000-000000000003');
      const started = {
        ...outbox(
          '33000000-0000-4000-8000-000000000013',
          A,
          'BUSINESS_DAY_STARTED',
          '2026-10-10T08:00:00.000Z',
        ),
        businessDayId: resetDayId,
      };
      const dependent = {
        ...outbox(
          '33000000-0000-4000-8000-000000000014',
          A,
          'WORKER_SIGNED_IN',
          '2026-10-10T07:59:59.000Z',
        ),
      };
      await db.transaction(async (tx) => {
        await tx.outbox.append(started);
        await tx.outbox.append(dependent);
        await tx.outbox.markDelivered(started.id, instant('2026-10-10T08:01:00.000Z'));
      });

      await expect(
        db.transaction((tx) => tx.outbox.recoverMissingBusinessDayStart(resetDayId)),
      ).resolves.toBe('RECOVERED');
      expect(
        (
          await db.transaction((tx) =>
            tx.outbox.listPending(instant('2026-10-10T09:00:00.000Z'), 50, A),
          )
        ).map((event) => event.id),
      ).toEqual([started.id, dependent.id]);
    } finally {
      await db.close();
    }
  });

  it('does not skip a delayed day start and deliver a dependent worker session', async () => {
    const name = 'tux-business-day-order-' + crypto.randomUUID();
    names.add(name);
    const db = new IndexedDbOperationsDatabase(name);
    await db.initialize();
    try {
      const day = outbox(
        '31000000-0000-4000-8000-000000000002',
        A,
        'BUSINESS_DAY_STARTED',
        '2026-10-10T08:00:00.000Z',
        '2026-10-10T08:05:00.000Z',
      );
      const worker = outbox(
        '31000000-0000-4000-8000-000000000001',
        A,
        'WORKER_SIGNED_IN',
        '2026-10-10T08:00:01.000Z',
      );
      const otherShop = outbox(
        '31000000-0000-4000-8000-000000000003',
        B,
        'BUSINESS_DAY_STARTED',
        '2026-10-10T08:00:02.000Z',
      );
      await db.transaction(async (tx) => {
        await tx.outbox.append(day);
        await tx.outbox.append(worker);
        await tx.outbox.append(otherShop);
      });
      expect(
        await db.transaction((tx) =>
          tx.outbox.listPending(instant('2026-10-10T08:00:03.000Z'), 50, A),
        ),
      ).toEqual([]);
      expect(
        (
          await db.transaction((tx) =>
            tx.outbox.listPending(instant('2026-10-10T08:00:03.000Z'), 50),
          )
        ).map((x) => x.id),
      ).toEqual([otherShop.id]);
      expect(
        (
          await db.transaction((tx) =>
            tx.outbox.listPending(instant('2026-10-10T08:05:00.000Z'), 50, A),
          )
        ).map((x) => x.id),
      ).toEqual([day.id, worker.id]);
    } finally {
      await db.close();
    }
  });

  it('keeps same-timestamp Order revisions in increasing revision order', async () => {
    const name = 'tux-order-revision-ties-' + crypto.randomUUID();
    names.add(name);
    const db = new IndexedDbOperationsDatabase(name);
    await db.initialize();
    try {
      const at = '2026-10-10T08:00:00.000Z';
      const placed = {
        ...outbox('34000000-0000-4000-8000-000000000002', A, 'ORDER_PLACED', at),
        aggregateType: 'ORDER' as const,
        aggregateId: 'order-a',
        aggregateRevision: 0,
      };
      const done = {
        ...outbox('34000000-0000-4000-8000-000000000001', A, 'ORDER_MARKED_DONE', at),
        aggregateType: 'ORDER' as const,
        aggregateId: 'order-a',
        aggregateRevision: 1,
      };
      await db.transaction(async (tx) => {
        await tx.outbox.append(placed);
        await tx.outbox.append(done);
      });
      expect(
        (await db.transaction((tx) => tx.outbox.listPending(instant(at), 50, A))).map((x) => x.id),
      ).toEqual([placed.id, done.id]);
    } finally {
      await db.close();
    }
  });

  it('orders same-timestamp day START before worker login regardless of UUID sort', async () => {
    const name = 'tux-business-day-ties-' + crypto.randomUUID();
    names.add(name);
    const db = new IndexedDbOperationsDatabase(name);
    await db.initialize();
    try {
      const t = '2026-10-10T08:00:00.000Z';
      const worker = outbox('32000000-0000-4000-8000-000000000001', A, 'WORKER_SIGNED_IN', t);
      const day = outbox('32000000-0000-4000-8000-000000000002', A, 'BUSINESS_DAY_STARTED', t);
      await db.transaction(async (tx) => {
        await tx.outbox.append(day);
        await tx.outbox.append(worker);
      });
      expect(
        (await db.transaction((tx) => tx.outbox.listPending(instant(t), 50, A))).map((x) => x.id),
      ).toEqual([day.id, worker.id]);
    } finally {
      await db.close();
    }
  });
});
