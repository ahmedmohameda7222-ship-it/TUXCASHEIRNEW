import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  instant,
  parseEntityId,
  type OutboxEvent,
  type OutboxEventId,
  type ShopId,
} from '@tux/domain';
import { SqliteOperationsDatabase } from '@tux/persistence/sqlite';
import { OutboxSyncService, type OutboxTransport } from '@tux/sync';
import { afterEach, describe, expect, it } from 'vitest';

const SHOP_ID = parseEntityId<ShopId>('13000000-0000-4000-8000-000000000001');
const EVENT_ID = parseEntityId<OutboxEventId>('23000000-0000-4000-8000-000000000001');
const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

function event(): OutboxEvent {
  return {
    id: EVENT_ID,
    shopId: SHOP_ID,
    businessDayId: null,
    aggregateType: 'ORDER',
    aggregateId: 'order-fixture',
    aggregateRevision: 0,
    eventType: 'ORDER_PLACED',
    idempotencyKey: 'order-placed:order-fixture',
    payloadVersion: 1,
    payload: { orderId: 'order-fixture', immutable: true },
    createdAt: instant('2026-08-18T10:00:00.000Z'),
    attemptCount: 0,
    nextAttemptAt: null,
    lastError: null,
    deliveredAt: null,
  };
}

function rawRow(databasePath: string): Record<string, unknown> {
  const raw = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const row = raw
      .prepare(
        'SELECT idempotency_key, payload_json, attempt_count, next_attempt_at, last_error, delivered_at FROM outbox_events WHERE id = ?',
      )
      .get(EVENT_ID) as Record<string, unknown> | undefined;
    if (row === undefined) throw new Error('Outbox fixture row was not found.');
    return row;
  } finally {
    raw.close();
  }
}

describe('automatic outbox sync SQLite integration', () => {
  it('persists backoff, skips early retry, then delivers the same immutable event', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'tux-sync-'));
    const databasePath = path.join(directory, 'operations.sqlite3');
    const database = new SqliteOperationsDatabase(databasePath);
    await database.initialize();
    cleanup.push(async () => {
      await database.close();
      await rm(directory, { recursive: true, force: true });
    });

    await database.transaction(async (transaction) => {
      await transaction.shops.put({ id: SHOP_ID, name: 'TUX Sync Test Shop', active: true });
      await transaction.outbox.append(event());
    });

    let now = instant('2026-08-18T11:00:00.000Z');
    let shouldFail = true;
    const deliveredKeys: string[] = [];
    const transport: OutboxTransport = {
      deliver: async (value) => {
        deliveredKeys.push(value.idempotencyKey);
        if (shouldFail) throw new Error('offline fixture');
      },
    };
    const service = new OutboxSyncService(database, transport, { now: () => now });

    const failed = await service.syncOnce();
    expect(failed).toMatchObject({
      attempted: 1,
      delivered: 0,
      failed: 1,
      blockedUntil: '2026-08-18T11:00:02.000Z',
      lastError: 'offline fixture',
    });
    const failedRow = rawRow(databasePath);
    expect(failedRow).toMatchObject({
      idempotency_key: 'order-placed:order-fixture',
      attempt_count: 1,
      next_attempt_at: '2026-08-18T11:00:02.000Z',
      last_error: 'offline fixture',
      delivered_at: null,
    });
    const failedPayload = JSON.parse(String(failedRow['payload_json'])) as OutboxEvent;
    expect(failedPayload.id).toBe(EVENT_ID);
    expect(failedPayload.idempotencyKey).toBe('order-placed:order-fixture');
    expect(failedPayload.payload).toEqual({ orderId: 'order-fixture', immutable: true });

    const early = await service.syncOnce();
    expect(early.attempted).toBe(0);
    expect(deliveredKeys).toEqual(['order-placed:order-fixture']);

    shouldFail = false;
    now = instant('2026-08-18T11:00:02.000Z');
    const succeeded = await service.syncOnce();
    expect(succeeded).toMatchObject({ attempted: 1, delivered: 1, failed: 0 });
    expect(deliveredKeys).toEqual(['order-placed:order-fixture', 'order-placed:order-fixture']);
    expect(rawRow(databasePath)).toMatchObject({
      idempotency_key: 'order-placed:order-fixture',
      attempt_count: 1,
      next_attempt_at: null,
      last_error: null,
      delivered_at: '2026-08-18T11:00:02.000Z',
    });
  });
});
