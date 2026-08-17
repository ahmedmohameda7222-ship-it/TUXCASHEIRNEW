import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createOpenBusinessDay,
  instant,
  parseEntityId,
  type BusinessDayId,
  type OperationsConfigurationSnapshot,
  type OutboxEvent,
  type OutboxEventId,
  type ShopId,
  type WorkerId,
} from '@tux/domain';
import { SqliteOperationsDatabase } from './SqliteOperationsDatabase';

const shopId = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const workerId = parseEntityId<WorkerId>('22222222-2222-4222-8222-222222222222');
const businessDayId = parseEntityId<BusinessDayId>('33333333-3333-4333-8333-333333333333');
const outboxId = parseEntityId<OutboxEventId>('44444444-4444-4444-8444-444444444444');

async function seedFoundation(database: SqliteOperationsDatabase): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction.shops.put({ id: shopId, name: 'TUX Test Shop', active: true });
    await transaction.workers.put({
      id: workerId,
      shopId,
      displayName: 'Test Worker',
      pinHash: '$test-only-non-production-hash$',
      active: true,
    });
    await transaction.businessDays.put(
      createOpenBusinessDay({
        id: businessDayId,
        shopId,
        startedAt: instant('2026-08-17T13:00:00Z'),
        startedByWorkerId: workerId,
      }),
    );
  });
}

function configurationSnapshot(): OperationsConfigurationSnapshot {
  return {
    shopId,
    version: 1,
    updatedAt: instant('2026-08-17T12:00:00Z'),
    categories: [],
    products: [],
    modifiers: [],
    productModifierLinks: [],
    comboBeverageOptions: [],
    recipeLines: [],
    orderTypes: [],
    paymentMethods: [],
    deliveryZones: [],
  };
}

function outboxEvent(): OutboxEvent {
  return {
    id: outboxId,
    shopId,
    businessDayId,
    aggregateType: 'BUSINESS_DAY',
    aggregateId: businessDayId,
    eventType: 'BUSINESS_DAY_STARTED',
    idempotencyKey: 'business-day-started-1',
    payloadVersion: 1,
    payload: { businessDayId },
    createdAt: instant('2026-08-17T13:00:00Z'),
    attemptCount: 0,
    nextAttemptAt: null,
    lastError: null,
    deliveredAt: null,
  };
}

describe('SqliteOperationsDatabase', () => {
  it('rolls back all writes when a transaction fails', async () => {
    const database = new SqliteOperationsDatabase(':memory:');
    await database.initialize();

    await expect(
      database.transaction(async (transaction) => {
        await transaction.shops.put({ id: shopId, name: 'TUX Test Shop', active: true });
        throw new Error('injected failure');
      }),
    ).rejects.toThrow('injected failure');

    const persisted = await database.transaction((transaction) =>
      transaction.shops.getById(shopId),
    );
    expect(persisted).toBeNull();
    await database.close();
  });

  it('persists configuration and pending outbox work across database restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tux-v2-'));
    const path = join(directory, 'operations.sqlite');

    const first = new SqliteOperationsDatabase(path);
    await first.initialize();
    await seedFoundation(first);
    await first.transaction(async (transaction) => {
      await transaction.configuration.put(configurationSnapshot());
      await transaction.outbox.append(outboxEvent());
    });
    await first.close();

    const second = new SqliteOperationsDatabase(path);
    await second.initialize();
    const result = await second.transaction(async (transaction) => ({
      configuration: await transaction.configuration.getForShop(shopId),
      pending: await transaction.outbox.listPending(instant('2026-08-17T14:00:00Z'), 10),
    }));

    expect(result.configuration?.version).toBe(1);
    expect(result.pending).toHaveLength(1);
    expect(result.pending[0]?.id).toBe(outboxId);
    await second.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('enforces one open Business Day per shop at the database boundary', async () => {
    const database = new SqliteOperationsDatabase(':memory:');
    await database.initialize();
    await seedFoundation(database);
    const secondBusinessDayId = parseEntityId<BusinessDayId>(
      '55555555-5555-4555-8555-555555555555',
    );

    await expect(
      database.transaction((transaction) =>
        transaction.businessDays.put(
          createOpenBusinessDay({
            id: secondBusinessDayId,
            shopId,
            startedAt: instant('2026-08-17T15:00:00Z'),
            startedByWorkerId: workerId,
          }),
        ),
      ),
    ).rejects.toThrow();
    await database.close();
  });
});
