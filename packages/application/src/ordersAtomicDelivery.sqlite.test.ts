import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  instant,
  moneyMinor,
  parseEntityId,
  stockQuantityMicros,
  type BusinessDayId,
  type InventoryItem,
  type MenuCategoryId,
  type CustomerContactId,
  type DeliveryZoneId,
  type InventoryItemId,
  type OpenBusinessDay,
  type OperationsConfigurationSnapshot,
  type OrderDraft,
  type DraftLineId,
  type OrderTypeId,
  type PaymentMethodId,
  type ProductId,
  type ShopId,
  type WorkerId,
  type WorkerSessionId,
} from '@tux/domain';
import type { OperationsDatabase, OperationsTransaction } from '@tux/persistence';
import {
  SqliteOperationsDatabase,
  SqliteOperatorSessionReadModel,
  SqliteOrderDraftStore,
} from '@tux/persistence/sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { ApplicationCommandCoordinator } from './commandCoordinator';
import { OperationsOrdersService } from './orders';

const shopId = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const workerId = parseEntityId<WorkerId>('22222222-2222-4222-8222-222222222222');
const businessDayId = parseEntityId<BusinessDayId>('33333333-3333-4333-8333-333333333333');
const orderTypeId = parseEntityId<OrderTypeId>('44444444-4444-4444-8444-444444444444');
const categoryId = parseEntityId<MenuCategoryId>('55555555-5555-4555-8555-555555555555');
const productId = parseEntityId<ProductId>('66666666-6666-4666-8666-666666666666');
const inventoryItemId = parseEntityId<InventoryItemId>('77777777-7777-4777-8777-777777777777');
const paymentMethodId = parseEntityId<PaymentMethodId>('88888888-8888-4888-8888-888888888888');
const deliveryZoneId = parseEntityId<DeliveryZoneId>('99999999-9999-4999-8999-999999999999');
const createdAt = instant('2026-08-20T00:00:00.000Z');

const inventoryItem: InventoryItem = {
  id: inventoryItemId,
  shopId,
  name: 'Beef',
  unitLabel: 'portion',
  trackingMode: 'RECIPE_TRACKED',
  active: true,
};

const configuration: OperationsConfigurationSnapshot = {
  shopId,
  version: 7,
  categories: [{ id: categoryId, shopId, name: 'Burgers', sortOrder: 1, active: true }],
  products: [
    {
      id: productId,
      shopId,
      categoryId,
      name: 'Atomic Burger',
      description: null,
      priceMinor: moneyMinor(10000),
      imageKey: null,
      active: true,
      soldOut: false,
      isCombo: false,
      sortOrder: 1,
    },
  ],
  modifiers: [],
  productModifierLinks: [],
  comboBeverageOptions: [],
  orderTypes: [
    { id: orderTypeId, shopId, name: 'Delivery', behavior: 'DELIVERY', sortOrder: 1, active: true },
  ],
  paymentMethods: [
    {
      id: paymentMethodId,
      shopId,
      displayName: 'Cash',
      logicType: 'CASH',
      requiresReconciliation: true,
      sortOrder: 1,
      active: true,
    },
  ],
  deliveryZones: [
    {
      id: deliveryZoneId,
      shopId,
      name: 'Zone A',
      feeMinor: moneyMinor(2500),
      active: true,
      sortOrder: 1,
    },
  ],
  recipeLines: [
    { shopId, productId, inventoryItemId, quantityMicros: stockQuantityMicros(1_000_000) },
  ],
  updatedAt: createdAt,
};

function draft(intent = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'): OrderDraft {
  return {
    shopId,
    businessDayId,
    draftScopeId: 'orders-main',
    revision: 0,
    updatedAt: createdAt,
    checkoutIntentKey: intent,
    orderTypeId,
    lines: [
      {
        id: parseEntityId<DraftLineId>('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
        productId,
        productName: 'Atomic Burger',
        unitPriceMinor: moneyMinor(10000),
        quantity: 1,
        modifiers: [],
        comboBeverages: [],
        itemNote: null,
        addedSequence: 0,
      },
    ],
    orderNote: null,
    discountMinor: moneyMinor(0),
    delivery: {
      displayPhone: '+20 101 234 5678',
      normalizedPhone: '01012345678',
      customerName: 'Customer One',
      address: '1 Atomic Street',
      zoneId: deliveryZoneId,
      zoneLabel: 'Zone A',
      configuredFeeMinor: moneyMinor(2500),
      finalFeeMinor: moneyMinor(2500),
    },
    payment: {
      mode: 'SINGLE',
      methodId: paymentMethodId,
      cashReceivedMinor: moneyMinor(12500),
    },
  };
}

async function seed(database: SqliteOperationsDatabase): Promise<void> {
  const day: OpenBusinessDay = {
    id: businessDayId,
    shopId,
    status: 'OPEN',
    startedAt: createdAt,
    endedAt: null,
    startedByWorkerId: workerId,
    endedByWorkerId: null,
    lastAllocatedDisplayOrderNo: 0,
  };
  await database.transaction(async (transaction) => {
    await transaction.shops.put({ id: shopId, name: 'Dev Shop', active: true });
    await transaction.workers.put({
      id: workerId,
      shopId,
      displayName: 'Dev Worker',
      pinHash: 'test-only',
      active: true,
    });
    await transaction.businessDays.put(day);
    await transaction.workerSessions.put({
      id: parseEntityId<WorkerSessionId>('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
      shopId,
      businessDayId,
      workerId,
      startedAt: createdAt,
      endedAt: null,
    });
    await transaction.configuration.put(configuration);
    await transaction.inventory.putItem(inventoryItem);
  });
}

class FailingCustomerContactDatabase implements OperationsDatabase {
  readonly #inner: OperationsDatabase;

  constructor(inner: OperationsDatabase) {
    this.#inner = inner;
  }

  transaction<Result>(
    work: (transaction: OperationsTransaction) => Promise<Result>,
  ): Promise<Result> {
    return this.#inner.transaction((transaction) =>
      work({
        ...transaction,
        customerContacts: {
          ...transaction.customerContacts,
          put: async () => {
            throw new Error('injected customer-contact write failure');
          },
        },
      }),
    );
  }
}

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(input?: { failContactWrite?: boolean }) {
  const directory = await mkdtemp(join(tmpdir(), 'tux-orders-atomic-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'operations.sqlite3');
  const database = new SqliteOperationsDatabase(path);
  await database.initialize();
  await seed(database);
  const readModel = new SqliteOperatorSessionReadModel(path);
  const draftStore = new SqliteOrderDraftStore(path);
  await draftStore.initialize();
  let sequence = 0;
  const runtime = {
    now: () => createdAt,
    createUuid: () => `10000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
  };
  const service = new OperationsOrdersService(
    input?.failContactWrite ? new FailingCustomerContactDatabase(database) : database,
    readModel,
    draftStore,
    runtime,
    new ApplicationCommandCoordinator(),
    { print: async () => ({ ok: true as const }) },
  );
  return { path, database, readModel, draftStore, service };
}

function scalar(path: string, sql: string): number {
  const db = new DatabaseSync(path);
  try {
    const row = db.prepare(sql).get() as Record<string, unknown> | undefined;
    return Number(row?.['value'] ?? 0);
  } finally {
    db.close();
  }
}

describe('Delivery customer learning checkout atomicity', () => {
  it('links a first-time Delivery Order to the exact contact and replay does not duplicate it', async () => {
    const test = await fixture();
    const input = draft();
    const first = await test.service.placeOrder(input);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.order.fulfillment.delivery?.customerContactId).not.toBeNull();
    const contactId = first.value.order.fulfillment.delivery!.customerContactId;

    const contact = await test.database.transaction((transaction) =>
      transaction.customerContacts.getByNormalizedPhone(shopId, '01012345678'),
    );
    expect(contact?.id).toBe(contactId);
    expect(contact?.latestAddress).toBe('1 Atomic Street');
    expect(scalar(test.path, 'select count(*) as value from customer_contacts')).toBe(1);

    const replay = await test.service.placeOrder(input);
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.value.replayed).toBe(true);
    expect(scalar(test.path, 'select count(*) as value from customer_contacts')).toBe(1);
    expect(scalar(test.path, 'select count(*) as value from orders')).toBe(1);
    expect(scalar(test.path, 'select count(*) as value from outbox_events')).toBe(1);
  });

  it('updates an existing contact inside the same checkout transaction', async () => {
    const test = await fixture();
    const contactId = parseEntityId<CustomerContactId>('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    await test.database.transaction((transaction) =>
      transaction.customerContacts.put({
        id: contactId,
        shopId,
        normalizedPhone: '01012345678',
        displayPhone: '01012345678',
        name: 'Old Name',
        latestAddress: 'Old Address',
        latestZoneId: null,
        lastOrderAt: instant('2026-08-19T00:00:00.000Z'),
      }),
    );

    const result = await test.service.placeOrder(draft('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.order.fulfillment.delivery?.customerContactId).toBe(contactId);
    const contact = await test.database.transaction((transaction) =>
      transaction.customerContacts.getByNormalizedPhone(shopId, '01012345678'),
    );
    expect(contact).toMatchObject({
      id: contactId,
      name: 'Customer One',
      latestAddress: '1 Atomic Street',
    });
  });

  it('rolls back the complete checkout and does not consume the display number when contact persistence fails', async () => {
    const test = await fixture({ failContactWrite: true });
    const result = await test.service.placeOrder(draft('ffffffff-ffff-4fff-8fff-ffffffffffff'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LOCAL_PERSISTENCE_ERROR');

    expect(scalar(test.path, 'select count(*) as value from customer_contacts')).toBe(0);
    expect(scalar(test.path, 'select count(*) as value from orders')).toBe(0);
    expect(scalar(test.path, 'select count(*) as value from inventory_movements')).toBe(0);
    expect(scalar(test.path, 'select count(*) as value from audit_events')).toBe(0);
    expect(scalar(test.path, 'select count(*) as value from outbox_events')).toBe(0);
    expect(
      scalar(
        test.path,
        `select last_allocated_display_order_no as value from business_days where id = '${businessDayId}'`,
      ),
    ).toBe(0);
  });
});
