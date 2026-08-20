import { describe, expect, it } from 'vitest';
import {
  instant,
  parseEntityId,
  type OutboxEvent,
  type OutboxEventId,
  type ShopId,
} from '@tux/domain';
import type { OperationsDatabase, OperationsTransaction } from '@tux/persistence';
import { nextOutboxRetryAt, outboxRetryDelayMs, OutboxSyncService } from './outboxSync';

const SHOP_ID = parseEntityId<ShopId>('11000000-0000-4000-8000-000000000001');

function outbox(id: string, createdAt: string): OutboxEvent {
  const eventId = parseEntityId<OutboxEventId>(id);
  return {
    id: eventId,
    shopId: SHOP_ID,
    businessDayId: null,
    aggregateType: 'ORDER',
    aggregateId: id,
    eventType: 'ORDER_PLACED',
    idempotencyKey: `order-placed:${id}`,
    payloadVersion: 1,
    payload: { id },
    createdAt: instant(createdAt),
    attemptCount: 0,
    nextAttemptAt: null,
    lastError: null,
    deliveredAt: null,
  };
}

class MemoryDatabase implements OperationsDatabase {
  readonly events = new Map<OutboxEventId, OutboxEvent>();
  async initialize(): Promise<void> {}
  async close(): Promise<void> {}
  async transaction<Result>(
    work: (transaction: OperationsTransaction) => Promise<Result>,
  ): Promise<Result> {
    const transaction = {
      outbox: {
        append: async (event: OutboxEvent) => {
          this.events.set(event.id, event);
        },
        listPending: async (now: ReturnType<typeof instant>, limit: number) =>
          [...this.events.values()]
            .filter(
              (event) =>
                event.deliveredAt === null &&
                (event.nextAttemptAt === null || event.nextAttemptAt <= now),
            )
            .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
            .slice(0, limit),
        markDelivered: async (id: OutboxEventId, deliveredAt: ReturnType<typeof instant>) => {
          const current = this.events.get(id);
          if (current === undefined) throw new Error('Missing event');
          this.events.set(id, { ...current, deliveredAt, nextAttemptAt: null, lastError: null });
        },
        recordFailure: async (
          id: OutboxEventId,
          attemptCount: number,
          nextAttemptAt: ReturnType<typeof instant>,
          lastError: string,
        ) => {
          const current = this.events.get(id);
          if (current === undefined) throw new Error('Missing event');
          this.events.set(id, { ...current, attemptCount, nextAttemptAt, lastError });
        },
      },
    } as unknown as OperationsTransaction;
    return work(transaction);
  }
}

const coordinator = { runExclusive: async <Result>(work: () => Promise<Result>) => work() };

describe('OutboxSyncService', () => {
  it('delivers oldest eligible events and marks delivered only after transport success', async () => {
    const database = new MemoryDatabase();
    const first = outbox('21000000-0000-4000-8000-000000000001', '2026-08-18T10:00:00.000Z');
    const second = outbox('21000000-0000-4000-8000-000000000002', '2026-08-18T10:01:00.000Z');
    database.events.set(second.id, second);
    database.events.set(first.id, first);
    const delivered: string[] = [];
    const service = new OutboxSyncService(
      database,
      {
        deliver: async (event) => {
          delivered.push(event.idempotencyKey);
          expect(database.events.get(event.id)?.deliveredAt).toBeNull();
        },
      },
      { now: () => instant('2026-08-18T11:00:00.000Z') },
      coordinator,
    );
    expect(await service.syncOnce()).toEqual({
      attempted: 2,
      delivered: 2,
      failed: 0,
      blockedUntil: null,
      lastError: null,
    });
    expect(delivered).toEqual([first.idempotencyKey, second.idempotencyKey]);
  });

  it('records retry metadata and stops the batch at the first failure', async () => {
    const database = new MemoryDatabase();
    const first = outbox('21000000-0000-4000-8000-000000000003', '2026-08-18T10:00:00.000Z');
    const second = outbox('21000000-0000-4000-8000-000000000004', '2026-08-18T10:01:00.000Z');
    database.events.set(first.id, first);
    database.events.set(second.id, second);
    const attempted: string[] = [];
    const service = new OutboxSyncService(
      database,
      {
        deliver: async (event) => {
          attempted.push(event.id);
          throw new Error('offline');
        },
      },
      { now: () => instant('2026-08-18T11:00:00.000Z') },
      coordinator,
    );
    const result = await service.syncOnce();
    expect(attempted).toEqual([first.id]);
    expect(result).toMatchObject({
      attempted: 1,
      delivered: 0,
      failed: 1,
      blockedUntil: '2026-08-18T11:00:02.000Z',
      lastError: 'offline',
    });
    expect(database.events.get(first.id)).toMatchObject({
      attemptCount: 1,
      nextAttemptAt: '2026-08-18T11:00:02.000Z',
      deliveredAt: null,
    });
    expect(database.events.get(second.id)?.attemptCount).toBe(0);
  });

  it('uses exponential retry with a five-minute cap', () => {
    expect(outboxRetryDelayMs(1)).toBe(2_000);
    expect(outboxRetryDelayMs(2)).toBe(4_000);
    expect(outboxRetryDelayMs(20)).toBe(300_000);
    expect(nextOutboxRetryAt(instant('2026-08-18T10:00:00.000Z'), 2)).toBe(
      '2026-08-18T10:00:04.000Z',
    );
  });
});
