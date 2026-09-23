import { describe, expect, it } from 'vitest';
import {
  instant,
  parseEntityId,
  stockQuantityMicros,
  type AuditEvent,
  type InventoryItemId,
  type InventoryMovement,
  type InventoryMovementId,
  type OrderId,
  type OrderSnapshot,
  type OutboxEvent,
  type OutboxEventId,
  type ShopId,
} from '@tux/domain';
import type { OperationsDatabase, OperationsTransaction } from '@tux/persistence';
import {
  nextOutboxRetryAt,
  outboxRetryDelayMs,
  OutboxDeliveryError,
  OutboxSyncService,
} from './outboxSync';

const SHOP_ID = parseEntityId<ShopId>('11000000-0000-4000-8000-000000000001');

function outbox(id: string, createdAt: string): OutboxEvent {
  const eventId = parseEntityId<OutboxEventId>(id);
  return {
    id: eventId,
    shopId: SHOP_ID,
    businessDayId: null,
    aggregateType: 'ORDER',
    aggregateId: id,
    aggregateRevision: 0,
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
  readonly orders = new Map<OrderId, OrderSnapshot>();
  readonly movements: InventoryMovement[] = [];
  readonly auditEvents: AuditEvent[] = [];
  async initialize(): Promise<void> {}
  async close(): Promise<void> {}
  async transaction<Result>(
    work: (transaction: OperationsTransaction) => Promise<Result>,
  ): Promise<Result> {
    const transaction = {
      orders: {
        getById: async (id: OrderId) => this.orders.get(id) ?? null,
        updateOperationalState: async (order: OrderSnapshot) => {
          this.orders.set(order.id, order);
        },
      },
      inventory: {
        listMovementsForOrder: async (orderId: OrderId) =>
          this.movements.filter((movement) => movement.orderId === orderId),
        appendMovement: async (movement: InventoryMovement) => {
          this.movements.push(movement);
        },
      },
      audit: {
        append: async (event: AuditEvent) => {
          this.auditEvents.push(event);
        },
      },
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
        quarantine: async (
          id: OutboxEventId,
          _quarantinedAt: ReturnType<typeof instant>,
          reason: string,
        ) => {
          const current = this.events.get(id);
          if (current === undefined) throw new Error('Missing event');
          this.events.set(id, { ...current, lastError: reason, nextAttemptAt: null });
        },
        quarantineDependents: async () => 0,
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
    );
    expect(await service.syncOnce()).toEqual({
      attempted: 2,
      delivered: 2,
      failed: 0,
      quarantined: 0,
      dependencyBlocked: 0,
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

  it('surfaces a fulfilled local order when canonical placement is rejected', async () => {
    const database = new MemoryDatabase();
    const placement = outbox('21000000-0000-4000-8000-000000000006', '2026-08-18T10:00:00.000Z');
    const orderId = parseEntityId<OrderId>(placement.aggregateId);
    const itemId = parseEntityId<InventoryItemId>('51000000-0000-4000-8000-000000000002');
    database.events.set(placement.id, placement);
    database.orders.set(orderId, {
      id: orderId,
      shopId: SHOP_ID,
      businessDayId: parseEntityId('31000000-0000-4000-8000-000000000001'),
      displayOrderNo: 8,
      idempotencyKey: 'checkout-8',
      status: 'DONE',
      lifecycle: {
        revision: 1,
        doneAt: instant('2026-08-18T10:05:00.000Z'),
        cancellation: null,
        returned: null,
      },
      operatorWorkerId: parseEntityId('41000000-0000-4000-8000-000000000001'),
      operatorName: 'Worker',
    } as unknown as OrderSnapshot);
    database.movements.push(
      {
        id: parseEntityId<InventoryMovementId>('61000000-0000-4000-8000-000000000002'),
        shopId: SHOP_ID,
        businessDayId: null,
        itemId,
        movementType: 'ORDER_RESERVATION',
        quantityDeltaMicros: stockQuantityMicros(0),
        reservedDeltaMicros: stockQuantityMicros(2_000_000),
        idempotencyKey: 'reservation-done-local',
        workerId: null,
        orderId,
        createdAt: instant('2026-08-18T10:00:00.000Z'),
        compensatesMovementId: null,
      },
      {
        id: parseEntityId<InventoryMovementId>('61000000-0000-4000-8000-000000000003'),
        shopId: SHOP_ID,
        businessDayId: null,
        itemId,
        movementType: 'ORDER_CONSUMPTION',
        quantityDeltaMicros: stockQuantityMicros(-2_000_000),
        reservedDeltaMicros: stockQuantityMicros(-2_000_000),
        idempotencyKey: 'consumption-done-local',
        workerId: null,
        orderId,
        createdAt: instant('2026-08-18T10:05:00.000Z'),
        compensatesMovementId: null,
      },
    );

    const service = new OutboxSyncService(
      database,
      {
        deliver: async () => {
          throw new OutboxDeliveryError(
            'Canonical inventory reservation rejected.',
            'PERMANENT',
            422,
          );
        },
      },
      { now: () => instant('2026-08-18T11:00:00.000Z') },
    );

    const result = await service.syncOnce();

    expect(database.orders.get(orderId)?.status).toBe('DONE');
    expect(database.movements).toHaveLength(2);
    expect(result.lastError).toMatch(/already DONE locally.*manual reconciliation/i);
    expect(database.auditEvents).toContainEqual(
      expect.objectContaining({
        aggregateType: 'ORDER',
        aggregateId: orderId,
        eventType: 'ORDER_SYNC_CONFLICT',
        details: expect.objectContaining({
          syncConflict: 'inventory_reservation_rejected_after_fulfillment',
          localStatus: 'DONE',
          manualReconciliationRequired: true,
        }),
      }),
    );
  });

  it.each([
    { status: 'RETURNED' as const, foodPrepared: null },
    { status: 'CANCELLED' as const, foodPrepared: true },
  ])(
    'surfaces a $status fulfilled local order when canonical placement is rejected',
    async ({ status, foodPrepared }) => {
      const database = new MemoryDatabase();
      const placement = outbox(
        status === 'RETURNED'
          ? '21000000-0000-4000-8000-000000000016'
          : '21000000-0000-4000-8000-000000000017',
        '2026-08-18T10:00:00.000Z',
      );
      const orderId = parseEntityId<OrderId>(placement.aggregateId);
      database.events.set(placement.id, placement);
      database.orders.set(orderId, {
        id: orderId,
        shopId: SHOP_ID,
        businessDayId: parseEntityId('31000000-0000-4000-8000-000000000001'),
        displayOrderNo: status === 'RETURNED' ? 16 : 17,
        idempotencyKey: `checkout-${status.toLowerCase()}`,
        status,
        lifecycle: {
          revision: 2,
          doneAt: instant('2026-08-18T10:05:00.000Z'),
          cancellation:
            status === 'CANCELLED'
              ? {
                  at: instant('2026-08-18T10:06:00.000Z'),
                  workerId: parseEntityId('41000000-0000-4000-8000-000000000001'),
                  workerName: 'Worker',
                  foodPrepared,
                  reason: 'Cancelled after preparation',
                  stockRestored: false,
                }
              : null,
          returned:
            status === 'RETURNED'
              ? {
                  at: instant('2026-08-18T10:06:00.000Z'),
                  workerId: parseEntityId('41000000-0000-4000-8000-000000000001'),
                  workerName: 'Worker',
                  reason: 'Delivery returned',
                }
              : null,
        },
        operatorWorkerId: parseEntityId('41000000-0000-4000-8000-000000000001'),
        operatorName: 'Worker',
      } as unknown as OrderSnapshot);

      const service = new OutboxSyncService(
        database,
        {
          deliver: async () => {
            throw new OutboxDeliveryError(
              'Canonical inventory reservation rejected.',
              'PERMANENT',
              422,
            );
          },
        },
        { now: () => instant('2026-08-18T11:00:00.000Z') },
      );

      const result = await service.syncOnce();

      expect(result.lastError).toMatch(/manual reconciliation required/i);
      expect(database.orders.get(orderId)?.status).toBe(status);
      expect(database.auditEvents).toContainEqual(
        expect.objectContaining({
          aggregateType: 'ORDER',
          aggregateId: orderId,
          eventType: 'ORDER_SYNC_CONFLICT',
          details: expect.objectContaining({
            syncConflict: 'inventory_reservation_rejected_after_fulfillment',
            localStatus: status,
            manualReconciliationRequired: true,
          }),
        }),
      );
    },
  );

  it('restores uncompensated legacy consumption after canonical placement rejection', async () => {
    const database = new MemoryDatabase();
    const placement = outbox('21000000-0000-4000-8000-000000000018', '2026-08-18T10:00:00.000Z');
    const orderId = parseEntityId<OrderId>(placement.aggregateId);
    const itemId = parseEntityId<InventoryItemId>('51000000-0000-4000-8000-000000000018');
    const consumptionId = parseEntityId<InventoryMovementId>(
      '61000000-0000-4000-8000-000000000018',
    );
    const alreadyCompensatedId = parseEntityId<InventoryMovementId>(
      '61000000-0000-4000-8000-000000000019',
    );
    database.events.set(placement.id, placement);
    database.orders.set(orderId, {
      id: orderId,
      shopId: SHOP_ID,
      businessDayId: parseEntityId('31000000-0000-4000-8000-000000000001'),
      displayOrderNo: 18,
      idempotencyKey: 'checkout-18',
      status: 'ACTIVE',
      lifecycle: { revision: 0, doneAt: null, cancellation: null, returned: null },
      operatorWorkerId: parseEntityId('41000000-0000-4000-8000-000000000001'),
      operatorName: 'Worker',
    } as unknown as OrderSnapshot);
    database.movements.push(
      {
        id: consumptionId,
        shopId: SHOP_ID,
        businessDayId: null,
        itemId,
        movementType: 'ORDER_CONSUMPTION',
        quantityDeltaMicros: stockQuantityMicros(-2_000_000),
        reservedDeltaMicros: stockQuantityMicros(0),
        idempotencyKey: 'legacy-consumption-local',
        workerId: null,
        orderId,
        createdAt: instant('2026-08-18T10:00:00.000Z'),
        compensatesMovementId: null,
      },
      {
        id: alreadyCompensatedId,
        shopId: SHOP_ID,
        businessDayId: null,
        itemId,
        movementType: 'ORDER_CONSUMPTION',
        quantityDeltaMicros: stockQuantityMicros(-1_000_000),
        reservedDeltaMicros: stockQuantityMicros(0),
        idempotencyKey: 'legacy-consumption-already-restored',
        workerId: null,
        orderId,
        createdAt: instant('2026-08-18T10:00:01.000Z'),
        compensatesMovementId: null,
      },
      {
        id: parseEntityId<InventoryMovementId>('61000000-0000-4000-8000-000000000020'),
        shopId: SHOP_ID,
        businessDayId: null,
        itemId,
        movementType: 'CANCEL_RESTOCK',
        quantityDeltaMicros: stockQuantityMicros(1_000_000),
        reservedDeltaMicros: stockQuantityMicros(0),
        idempotencyKey: 'legacy-consumption-existing-restock',
        workerId: null,
        orderId,
        createdAt: instant('2026-08-18T10:00:02.000Z'),
        compensatesMovementId: alreadyCompensatedId,
      },
    );

    const service = new OutboxSyncService(
      database,
      {
        deliver: async () => {
          throw new OutboxDeliveryError(
            'Canonical inventory reservation rejected.',
            'PERMANENT',
            422,
          );
        },
      },
      { now: () => instant('2026-08-18T11:00:00.000Z') },
    );

    const result = await service.syncOnce();

    expect(result).toMatchObject({ quarantined: 1, failed: 0 });
    expect(database.orders.get(orderId)?.status).toBe('CANCELLED');
    const restocks = database.movements.filter(
      (movement) => movement.movementType === 'CANCEL_RESTOCK',
    );
    expect(restocks).toHaveLength(2);
    expect(restocks).toContainEqual(
      expect.objectContaining({
        orderId,
        itemId,
        movementType: 'CANCEL_RESTOCK',
        quantityDeltaMicros: 2_000_000,
        reservedDeltaMicros: 0,
        compensatesMovementId: consumptionId,
      }),
    );
    expect(
      restocks.filter((movement) => movement.compensatesMovementId === alreadyCompensatedId),
    ).toHaveLength(1);
  });

  it('cancels an active local order and releases its reservation after canonical rejection', async () => {
    const database = new MemoryDatabase();
    const placement = outbox('21000000-0000-4000-8000-000000000005', '2026-08-18T10:00:00.000Z');
    const orderId = parseEntityId<OrderId>(placement.aggregateId);
    const itemId = parseEntityId<InventoryItemId>('51000000-0000-4000-8000-000000000001');
    const reservationId = parseEntityId<InventoryMovementId>(
      '61000000-0000-4000-8000-000000000001',
    );
    database.events.set(placement.id, placement);
    database.orders.set(orderId, {
      id: orderId,
      shopId: SHOP_ID,
      businessDayId: parseEntityId('31000000-0000-4000-8000-000000000001'),
      displayOrderNo: 7,
      idempotencyKey: 'checkout-7',
      status: 'ACTIVE',
      lifecycle: { revision: 0, doneAt: null, cancellation: null, returned: null },
      operatorWorkerId: parseEntityId('41000000-0000-4000-8000-000000000001'),
      operatorName: 'Worker',
    } as unknown as OrderSnapshot);
    database.movements.push({
      id: reservationId,
      shopId: SHOP_ID,
      businessDayId: null,
      itemId,
      movementType: 'ORDER_RESERVATION',
      quantityDeltaMicros: stockQuantityMicros(0),
      reservedDeltaMicros: stockQuantityMicros(2_000_000),
      idempotencyKey: 'reservation-local',
      workerId: null,
      orderId,
      createdAt: instant('2026-08-18T10:00:00.000Z'),
      compensatesMovementId: null,
    });

    const service = new OutboxSyncService(
      database,
      {
        deliver: async () => {
          throw new OutboxDeliveryError(
            'Canonical inventory reservation rejected.',
            'PERMANENT',
            422,
          );
        },
      },
      { now: () => instant('2026-08-18T11:00:00.000Z') },
    );

    const result = await service.syncOnce();

    expect(result).toMatchObject({ quarantined: 1, failed: 0 });
    expect(database.orders.get(orderId)).toMatchObject({
      status: 'CANCELLED',
      lifecycle: {
        cancellation: {
          stockRestored: true,
        },
      },
    });
    expect(database.movements).toContainEqual(
      expect.objectContaining({
        orderId,
        itemId,
        movementType: 'ORDER_RESERVATION_RELEASE',
        reservedDeltaMicros: -2_000_000,
      }),
    );
  });
});
