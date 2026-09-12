import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  instant,
  parseEntityId,
  type DeliveryZoneId,
  type PaymentMethodId,
  type ShopId,
} from '@tux/domain';
import { SqliteOperationsDatabase } from '@tux/persistence/sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { ApplicationCommandCoordinator } from './commandCoordinator';
import { OperationsConfigurationSyncService } from './configurationSync';

const shopId = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const paymentMethodId = parseEntityId<PaymentMethodId>('22222222-2222-4222-8222-222222222222');
const deliveryZoneId = parseEntityId<DeliveryZoneId>('33333333-3333-4333-8333-333333333333');
const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

function publishedBundle() {
  return {
    snapshot: {
      shopId,
      version: 4,
      updatedAt: instant('2026-09-11T20:00:00.000Z'),
      categories: [],
      products: [],
      modifiers: [],
      productModifierLinks: [],
      comboBeverageOptions: [],
      recipeLines: [],
      orderTypes: [],
      paymentMethods: [
        {
          id: paymentMethodId,
          shopId,
          displayName: 'Card',
          logicType: 'CARD' as const,
          requiresReconciliation: true,
          active: true,
          sortOrder: 0,
          channel: 'ONLINE' as const,
          requiresReference: true,
          manualConfirmationRequired: false,
          refundAllowed: true,
          integrationReference: 'stripe-main',
        },
      ],
      deliveryZones: [
        {
          id: deliveryZoneId,
          shopId,
          name: 'Maadi',
          feeMinor: 2500,
          active: true,
          sortOrder: 0,
        },
      ],
      settings: {
        version: 7,
        values: {
          'checkout.minimumOrderMinor': 1500,
          'receipt.orderPrefix': 'MD-',
          'receipt.footer': 'Thank you',
        },
        shopIdentity: {
          shopId,
          displayName: 'TUX Maadi',
          address: 'Road 9',
          phone: '+201000000000',
          latitude: 29.9602,
          longitude: 31.2569,
          timezone: 'Africa/Cairo' as const,
          lifecycleState: 'ACTIVE' as const,
          temporaryClosed: false,
          onlineOrdersPaused: false,
        },
        weeklyHours: [],
        specialHours: [],
        paymentMethodZoneRules: [{ paymentMethodId, deliveryZoneId, allowed: false }],
      },
      reasonCodes: [
        {
          id: '44444444-4444-4444-8444-444444444444',
          key: 'customer-request',
          family: 'CANCELLATION' as const,
          label: 'Customer request',
          active: true,
          version: 2,
          scope: 'BUSINESS' as const,
        },
      ],
    },
    inventoryItems: [],
  };
}

describe('Operations settings configuration SQLite sync', () => {
  it('persists published settings, payment controls, and reason codes without dropping fields', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tux-settings-sync-'));
    tempDirectories.push(directory);
    const database = new SqliteOperationsDatabase(join(directory, 'operations.sqlite'));
    await database.initialize();
    await database.transaction((transaction) =>
      transaction.shops.put({ id: shopId, name: 'Config Test Shop', active: true }),
    );

    const service = new OperationsConfigurationSyncService(
      database,
      new ApplicationCommandCoordinator(),
      {
        async discoverVersion() {
          return 4;
        },
        async fetchCompleteConfiguration() {
          return publishedBundle();
        },
      },
    );

    await expect(service.sync(shopId)).resolves.toEqual({ status: 'APPLIED', version: 4 });

    const persisted = await database.transaction((transaction) =>
      transaction.configuration.getForShop(shopId),
    );
    expect(persisted?.settings).toMatchObject({
      version: 7,
      values: { 'receipt.orderPrefix': 'MD-' },
      shopIdentity: { displayName: 'TUX Maadi', timezone: 'Africa/Cairo' },
    });
    expect(persisted?.paymentMethods[0]).toMatchObject({
      channel: 'ONLINE',
      requiresReference: true,
      integrationReference: 'stripe-main',
    });
    expect(persisted?.reasonCodes?.[0]).toMatchObject({
      family: 'CANCELLATION',
      label: 'Customer request',
      version: 2,
    });

    await database.close();
  });
});
