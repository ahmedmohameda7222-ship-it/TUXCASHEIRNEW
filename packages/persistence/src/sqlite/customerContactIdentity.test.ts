import { describe, expect, it } from 'vitest';
import {
  instant,
  parseEntityId,
  type CustomerContactId,
  type ShopId,
} from '@tux/domain';
import { SqliteOperationsDatabase } from './index';

const shopId = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const firstContactId = parseEntityId<CustomerContactId>(
  '66666666-6666-4666-8666-666666666666',
);
const conflictingContactId = parseEntityId<CustomerContactId>(
  '77777777-7777-4777-8777-777777777777',
);

describe('SQLite customer contact identity', () => {
  it('does not replace an existing contact UUID for the same normalized phone', async () => {
    const database = new SqliteOperationsDatabase(':memory:');
    await database.initialize();

    await database.transaction(async (transaction) => {
      await transaction.shops.put({ id: shopId, name: 'TUX Test Shop', active: true });
      await transaction.customerContacts.put({
        id: firstContactId,
        shopId,
        normalizedPhone: '201001234567',
        displayPhone: '01001234567',
        name: 'First Contact',
        latestAddress: 'Address A',
        latestZoneId: null,
        lastOrderAt: instant('2026-08-17T13:00:00Z'),
      });
    });

    await expect(
      database.transaction((transaction) =>
        transaction.customerContacts.put({
          id: conflictingContactId,
          shopId,
          normalizedPhone: '201001234567',
          displayPhone: '01001234567',
          name: 'Conflicting Contact',
          latestAddress: 'Address B',
          latestZoneId: null,
          lastOrderAt: instant('2026-08-17T14:00:00Z'),
        }),
      ),
    ).rejects.toThrow('Customer contact identity mismatch');

    const persisted = await database.transaction((transaction) =>
      transaction.customerContacts.getByNormalizedPhone(shopId, '201001234567'),
    );

    expect(persisted?.id).toBe(firstContactId);
    await database.close();
  });
});
