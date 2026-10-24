import 'fake-indexeddb/auto';

import {
  createOpenBusinessDay,
  instant,
  parseEntityId,
  type BusinessDayId,
  type ShopId,
  type WorkerId,
} from '@tux/domain';
import { IndexedDbOperationsDatabase } from '@tux/persistence/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { recoverMissingBusinessDayStart } from './businessDayStartRecovery';

const names = new Set<string>();

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

describe('Business Day start recovery', () => {
  it('reconstructs a missing start from the exact local day once', async () => {
    const name = `tux-day-start-recovery-${crypto.randomUUID()}`;
    names.add(name);
    const database = new IndexedDbOperationsDatabase(name);
    await database.initialize();
    const shopId = parseEntityId<ShopId>('11000000-0000-4000-8000-000000000001');
    const businessDayId = parseEntityId<BusinessDayId>('21000000-0000-4000-8000-000000000001');
    const workerId = parseEntityId<WorkerId>('31000000-0000-4000-8000-000000000001');
    const day = createOpenBusinessDay({
      id: businessDayId,
      shopId,
      startedAt: instant('2026-10-24T08:00:00.000Z'),
      startedByWorkerId: workerId,
    });
    await database.transaction((transaction) => transaction.businessDays.put(day));

    try {
      await expect(
        recoverMissingBusinessDayStart({
          database,
          businessDayId,
          shopId,
          createUuid: () => '41000000-0000-4000-8000-000000000001',
        }),
      ).resolves.toBe('RECONSTRUCTED');
      await expect(
        recoverMissingBusinessDayStart({
          database,
          businessDayId,
          shopId,
          createUuid: () => '41000000-0000-4000-8000-000000000002',
        }),
      ).resolves.toBe('PRESENT');

      const pending = await database.transaction((transaction) =>
        transaction.outbox.listPending(instant('2026-10-24T09:00:00.000Z'), 50, shopId),
      );
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({
        businessDayId,
        eventType: 'BUSINESS_DAY_STARTED',
        idempotencyKey: `business_day_started:${businessDayId}`,
        createdAt: day.startedAt,
      });
    } finally {
      await database.close();
    }
  });
});
