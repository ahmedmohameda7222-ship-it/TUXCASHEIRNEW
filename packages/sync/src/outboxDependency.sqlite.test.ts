import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  instant,
  parseEntityId,
  type OutboxEvent,
  type OutboxEventId,
  type ShopId,
} from '@tux/domain';
import { SqliteOperationsDatabase } from '@tux/persistence/sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { OutboxDeliveryError, OutboxSyncService, type OutboxTransport } from './outboxSync';

const SHOP_ID = parseEntityId<ShopId>('91000000-0000-4000-8000-000000000001');
const cleanup: Array<() => Promise<void>> = [];

function event(input: {
  id: string;
  aggregateId: string;
  revision: number;
  createdAt: string;
}): OutboxEvent {
  return {
    id: parseEntityId<OutboxEventId>(input.id),
    shopId: SHOP_ID,
    businessDayId: null,
    aggregateType: 'ORDER',
    aggregateId: input.aggregateId,
    aggregateRevision: input.revision,
    eventType: input.revision === 0 ? 'ORDER_PLACED' : 'ORDER_MARKED_DONE',
    idempotencyKey: `${input.aggregateId}:${input.revision}`,
    payloadVersion: 1,
    payload: { aggregateId: input.aggregateId, revision: input.revision },
    createdAt: instant(input.createdAt),
    attemptCount: 0,
    nextAttemptAt: null,
    lastError: null,
    deliveredAt: null,
  };
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'tux-outbox-dependency-'));
  const databasePath = join(directory, 'operations.sqlite3');
  const database = new SqliteOperationsDatabase(databasePath);
  await database.initialize();
  await database.transaction((transaction) =>
    transaction.shops.put({ id: SHOP_ID, name: 'Sync Test Shop', active: true }),
  );
  cleanup.push(async () => {
    await database.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  });
  return { database, databasePath };
}

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

describe('aggregate-aware outbox dependency safety', () => {
  it('quarantines dependent Order A revisions while unrelated Order B continues and restart stays quiet', async () => {
    const { database, databasePath } = await fixture();
    const orderA = 'order-A';
    const orderB = 'order-B';
    const aPlaced = event({
      id: '92000000-0000-4000-8000-000000000001',
      aggregateId: orderA,
      revision: 0,
      createdAt: '2026-08-20T00:00:00.000Z',
    });
    const aDone = event({
      id: '92000000-0000-4000-8000-000000000002',
      aggregateId: orderA,
      revision: 1,
      createdAt: '2026-08-20T00:00:01.000Z',
    });
    const bPlaced = event({
      id: '92000000-0000-4000-8000-000000000003',
      aggregateId: orderB,
      revision: 0,
      createdAt: '2026-08-20T00:00:02.000Z',
    });
    await database.transaction(async (transaction) => {
      await transaction.outbox.append(aPlaced);
      await transaction.outbox.append(aDone);
      await transaction.outbox.append(bPlaced);
    });

    const delivered: string[] = [];
    const transport: OutboxTransport = {
      deliver: async (candidate) => {
        if (candidate.id === aPlaced.id) {
          throw new OutboxDeliveryError(
            'Placement payload is permanently invalid.',
            'PERMANENT',
            422,
          );
        }
        delivered.push(candidate.id);
      },
    };
    const service = new OutboxSyncService(database, transport, {
      now: () => instant('2026-08-20T01:00:00.000Z'),
    });

    const summary = await service.syncOnce();
    expect(summary).toMatchObject({
      attempted: 2,
      delivered: 1,
      failed: 0,
      quarantined: 1,
      dependencyBlocked: 1,
    });
    expect(delivered).toEqual([bPlaced.id]);
    expect(await service.syncOnce()).toMatchObject({ attempted: 0, delivered: 0, failed: 0 });

    await database.close();
    const reopened = new SqliteOperationsDatabase(databasePath);
    await reopened.initialize();
    const pendingAfterRestart = await reopened.transaction((transaction) =>
      transaction.outbox.listPending(instant('2026-08-20T02:00:00.000Z'), 50),
    );
    expect(pendingAfterRestart).toHaveLength(0);

    const laterADependent = event({
      id: '92000000-0000-4000-8000-000000000004',
      aggregateId: orderA,
      revision: 2,
      createdAt: '2026-08-20T02:00:01.000Z',
    });
    await reopened.transaction((transaction) => transaction.outbox.append(laterADependent));
    expect(
      await reopened.transaction((transaction) =>
        transaction.outbox.listPending(instant('2026-08-20T03:00:00.000Z'), 50),
      ),
    ).toHaveLength(0);
    await reopened.close();
  });

  it('keeps transient failure ordered and retries the origin before later revisions', async () => {
    const { database } = await fixture();
    const first = event({
      id: '93000000-0000-4000-8000-000000000001',
      aggregateId: 'order-transient',
      revision: 0,
      createdAt: '2026-08-20T00:00:00.000Z',
    });
    const second = event({
      id: '93000000-0000-4000-8000-000000000002',
      aggregateId: 'order-transient',
      revision: 1,
      createdAt: '2026-08-20T00:00:01.000Z',
    });
    await database.transaction(async (transaction) => {
      await transaction.outbox.append(first);
      await transaction.outbox.append(second);
    });

    let fail = true;
    const attempted: string[] = [];
    let now = instant('2026-08-20T01:00:00.000Z');
    const service = new OutboxSyncService(
      database,
      {
        deliver: async (candidate) => {
          attempted.push(candidate.id);
          if (fail) throw new Error('offline');
        },
      },
      { now: () => now },
    );

    expect(await service.syncOnce()).toMatchObject({ attempted: 1, failed: 1 });
    expect(attempted).toEqual([first.id]);

    fail = false;
    now = instant('2026-08-20T01:00:02.000Z');
    expect(await service.syncOnce()).toMatchObject({ attempted: 2, delivered: 2, failed: 0 });
    expect(attempted).toEqual([first.id, first.id, second.id]);
  });
});
