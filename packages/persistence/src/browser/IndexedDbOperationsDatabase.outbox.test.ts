import 'fake-indexeddb/auto';

import {
  instant,
  parseEntityId,
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

  it('orders same-timestamp day START before worker login regardless of UUID sort', async () => {
    const name = 'tux-business-day-ties-' + crypto.randomUUID();
    names.add(name);
    const db = new IndexedDbOperationsDatabase(name);
    await db.initialize();
    try {
      const t = '2026-10-10T08:00:00.000Z';
      const worker = outbox(
        '32000000-0000-4000-8000-000000000001',
        A,
        'WORKER_SIGNED_IN',
        t,
      );
      const day = outbox(
        '32000000-0000-4000-8000-000000000002',
        A,
        'BUSINESS_DAY_STARTED',
        t,
      );
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
