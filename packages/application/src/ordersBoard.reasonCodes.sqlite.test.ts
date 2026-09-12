import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  instant,
  moneyMinor,
  orderLifecycle,
  parseEntityId,
  type BusinessDayId,
  type OrderId,
  type OrderItemId,
  type OrderSnapshot,
  type OrderTypeId,
  type ProductId,
  type ShopId,
  type WorkerId,
  type WorkerSessionId,
} from '@tux/domain';
import { SqliteOperationsDatabase, SqliteOperatorSessionReadModel } from '@tux/persistence/sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { ApplicationCommandCoordinator } from './commandCoordinator';
import { OperationsOrdersBoardService, type CancelOrderInput } from './ordersBoard';

const shopId = parseEntityId<ShopId>('10000000-0000-4000-8000-000000000001');
const workerId = parseEntityId<WorkerId>('20000000-0000-4000-8000-000000000001');
const businessDayId = parseEntityId<BusinessDayId>('30000000-0000-4000-8000-000000000001');
const orderId = parseEntityId<OrderId>('40000000-0000-4000-8000-000000000001');
const createdAt = instant('2026-09-11T21:30:00.000Z');
const cancellationReason = {
  id: '50000000-0000-4000-8000-000000000001',
  key: 'CUSTOMER_CHANGED_MIND',
  family: 'CANCELLATION' as const,
  label: 'Customer changed mind',
  active: true,
  version: 4,
  scope: 'SHOP' as const,
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'tux-reason-code-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'operations.sqlite3');
  const database = new SqliteOperationsDatabase(path);
  await database.initialize();
  const readModel = new SqliteOperatorSessionReadModel(path);

  const order: OrderSnapshot = {
    id: orderId,
    shopId,
    businessDayId,
    displayOrderNo: 17,
    idempotencyKey: 'reason-code-order',
    status: 'ACTIVE',
    lifecycle: { revision: 0, doneAt: null, cancellation: null, returned: null },
    source: 'POS',
    operatorWorkerId: workerId,
    operatorName: 'Worker One',
    createdAt,
    fulfillment: {
      orderTypeId: parseEntityId<OrderTypeId>('60000000-0000-4000-8000-000000000001'),
      orderTypeLabel: 'Take Away',
      behavior: 'TAKE_AWAY',
      delivery: null,
    },
    items: [
      {
        id: parseEntityId<OrderItemId>('61000000-0000-4000-8000-000000000001'),
        productId: parseEntityId<ProductId>('62000000-0000-4000-8000-000000000001'),
        productName: 'Test item',
        unitPriceMinor: moneyMinor(0),
        quantity: 1,
        modifiers: [],
        comboBeverages: [],
        itemNote: null,
      },
    ],
    orderNote: null,
    itemsSubtotalMinor: moneyMinor(0),
    discountMinor: moneyMinor(0),
    deliveryFeeMinor: moneyMinor(0),
    totalMinor: moneyMinor(0),
    payments: [],
  };

  await database.transaction(async (transaction) => {
    await transaction.shops.put({ id: shopId, name: 'TUX Maadi', active: true });
    await transaction.workers.put({
      id: workerId,
      shopId,
      displayName: 'Worker One',
      pinHash: 'test-only',
      active: true,
    });
    await transaction.businessDays.put({
      id: businessDayId,
      shopId,
      status: 'OPEN',
      startedAt: createdAt,
      endedAt: null,
      startedByWorkerId: workerId,
      endedByWorkerId: null,
      lastAllocatedDisplayOrderNo: 17,
    });
    await transaction.workerSessions.put({
      id: parseEntityId<WorkerSessionId>('70000000-0000-4000-8000-000000000001'),
      shopId,
      businessDayId,
      workerId,
      startedAt: createdAt,
      endedAt: null,
    });
    await transaction.configuration.put({
      shopId,
      version: 11,
      updatedAt: createdAt,
      categories: [],
      products: [],
      modifiers: [],
      productModifierLinks: [],
      comboBeverageOptions: [],
      recipeLines: [],
      orderTypes: [],
      paymentMethods: [],
      deliveryZones: [],
      settings: null,
      reasonCodes: [cancellationReason],
    });
    await transaction.orders.insert(order);
  });

  let sequence = 0;
  const service = new OperationsOrdersBoardService(
    database,
    readModel,
    {
      now: () => instant('2026-09-11T21:31:00.000Z'),
      createUuid: () => `80000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
    },
    new ApplicationCommandCoordinator(),
  );

  return { database, readModel, service };
}

describe('configured cancellation reasons', () => {
  it('exposes active published cancellation reasons to the Orders Board UI', async () => {
    const test = await fixture();
    try {
      const board = await test.service.loadBoard();
      expect(board.ok).toBe(true);
      if (!board.ok) throw new Error(board.error.message);
      expect(board.value.cancellationReasonMode).toBe('CONFIGURED');
      expect(board.value.cancellationReasons).toEqual([
        {
          id: cancellationReason.id,
          key: cancellationReason.key,
          label: cancellationReason.label,
          version: cancellationReason.version,
          scope: cancellationReason.scope,
        },
      ]);
    } finally {
      await test.readModel.close();
    }
  });

  it('uses the active configured reason as immutable cancellation authority and keeps free text as note only', async () => {
    const test = await fixture();
    try {
      const input = {
        orderId,
        foodPrepared: true,
        reason: 'arbitrary legacy free text',
        reasonCodeId: cancellationReason.id,
        note: 'Customer called after placing the order',
      } as CancelOrderInput & { readonly reasonCodeId: string; readonly note: string };

      const result = await test.service.cancelOrder(input);
      if (!result.ok) {
        const cause =
          result.error.cause instanceof Error ? result.error.cause.message : result.error.cause;
        throw new Error(
          `Expected configured cancellation to succeed, got ${result.error.code}: ${result.error.message}; cause=${String(cause ?? 'none')}`,
        );
      }

      expect(orderLifecycle(result.value).cancellation as unknown).toEqual(
        expect.objectContaining({
          reason: cancellationReason.label,
          note: 'Customer called after placing the order',
          reasonCode: {
            id: cancellationReason.id,
            key: cancellationReason.key,
            family: cancellationReason.family,
            label: cancellationReason.label,
            version: cancellationReason.version,
            scope: cancellationReason.scope,
          },
        }),
      );
    } finally {
      await test.readModel.close();
    }
  });

  it('rejects free-text-only cancellation once published cancellation reasons are configured', async () => {
    const test = await fixture();
    try {
      const result = await test.service.cancelOrder({
        orderId,
        foodPrepared: true,
        reason: 'typed reason must not become canonical',
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('configured cancellation unexpectedly succeeded without reason code');
      expect(result.error.code).toBe('CONFLICT_ERROR');
      expect(result.error.message).toMatch(/published cancellation reason/i);
    } finally {
      await test.readModel.close();
    }
  });

  it('keeps free-text cancellation only for a genuinely pre-feature configuration snapshot', async () => {
    const test = await fixture();
    try {
      await test.database.transaction((transaction) =>
        transaction.configuration.put({
          shopId,
          version: 12,
          updatedAt: createdAt,
          categories: [],
          products: [],
          modifiers: [],
          productModifierLinks: [],
          comboBeverageOptions: [],
          recipeLines: [],
          orderTypes: [],
          paymentMethods: [],
          deliveryZones: [],
          settings: null,
          reasonCodes: [],
        }),
      );

      const result = await test.service.cancelOrder({
        orderId,
        foodPrepared: true,
        reason: 'Legacy free-text reason',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      const cancellation = orderLifecycle(result.value).cancellation;
      expect(cancellation).toMatchObject({ reason: 'Legacy free-text reason' });
      expect((cancellation as { reasonCode?: unknown } | null)?.reasonCode).toBeUndefined();
    } finally {
      await test.readModel.close();
    }
  });
});
