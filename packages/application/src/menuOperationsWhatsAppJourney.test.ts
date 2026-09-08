import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  instant,
  moneyMinor,
  parseEntityId,
  stockQuantityMicros,
  type BusinessDayId,
  type DeliveryZoneId,
  type DeviceId,
  type InventoryItemId,
  type MenuCategoryId,
  type OperationsConfigurationSnapshot,
  type OrderId,
  type OrderTypeId,
  type PaymentMethodId,
  type ProductId,
  type ShopId,
  type WhatsAppConversation,
  type WhatsAppMessage,
  type WorkerId,
  type WorkerSessionId,
} from '@tux/domain';
import type { CachedOnlineOrderRequest, WhatsAppStore } from '@tux/persistence';
import {
  SqliteOperationsDatabase,
  SqliteOperatorSessionReadModel,
  SqliteOrderDraftStore,
} from '@tux/persistence/sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  handleOrderIntakeRequest,
  type OnlineOrderCatalogAuthority,
  type OnlineOrderIntakeStore,
  type OnlineOrderPendingInsert,
  type OnlineOrderStoredRequest,
} from '../../../supabase/functions/order-intake/order-intake.ts';
import { ApplicationCommandCoordinator } from './commandCoordinator';
import { OperationsOnlineOrderAcceptanceService } from './onlineOrderAcceptance';
import { OperationsOrdersService } from './orders';
import type { OperationsSessionResult } from './session';
import { OperationsWhatsAppService } from './whatsapp';
import type { WhatsAppInboxSnapshot, WhatsAppRemoteGateway } from './whatsappRemote';

const SHOP_ID = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const DAY_ID = parseEntityId<BusinessDayId>('22222222-2222-4222-8222-222222222222');
const WORKER_ID = parseEntityId<WorkerId>('33333333-3333-4333-8333-333333333333');
const CATEGORY_ID = parseEntityId<MenuCategoryId>('44444444-4444-4444-8444-444444444444');
const PRODUCT_ID = parseEntityId<ProductId>('55555555-5555-4555-8555-555555555555');
const INVENTORY_ID = parseEntityId<InventoryItemId>('66666666-6666-4666-8666-666666666666');
const DELIVERY_TYPE_ID = parseEntityId<OrderTypeId>('77777777-7777-4777-8777-777777777777');
const ZONE_ID = parseEntityId<DeliveryZoneId>('88888888-8888-4888-8888-888888888888');
const CASH_ID = parseEntityId<PaymentMethodId>('99999999-9999-4999-8999-999999999999');
const SESSION_ID = parseEntityId<WorkerSessionId>('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const IDEMPOTENCY_KEY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RESERVED_ORDER_ID = parseEntityId<OrderId>('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
const DEVICE_ID = parseEntityId<DeviceId>('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
const CONVERSATION_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const AT = instant('2026-09-08T17:30:00.000Z');
const CANONICAL_PHONE = '01001234567';
const temporaryDirectories: string[] = [];

const CONFIGURATION: OperationsConfigurationSnapshot = {
  shopId: SHOP_ID,
  version: 1,
  updatedAt: AT,
  categories: [{ id: CATEGORY_ID, shopId: SHOP_ID, name: 'Burgers', sortOrder: 0, active: true }],
  products: [
    {
      id: PRODUCT_ID,
      shopId: SHOP_ID,
      categoryId: CATEGORY_ID,
      name: 'Canonical Tux Burger',
      description: null,
      priceMinor: moneyMinor(19_000),
      imageKey: null,
      active: true,
      soldOut: false,
      isCombo: false,
      sortOrder: 0,
    },
  ],
  modifiers: [],
  productModifierLinks: [],
  comboBeverageOptions: [],
  recipeLines: [
    {
      shopId: SHOP_ID,
      productId: PRODUCT_ID,
      inventoryItemId: INVENTORY_ID,
      quantityMicros: stockQuantityMicros(1_000_000),
    },
  ],
  orderTypes: [
    {
      id: DELIVERY_TYPE_ID,
      shopId: SHOP_ID,
      name: 'Delivery',
      behavior: 'DELIVERY',
      active: true,
      sortOrder: 0,
    },
  ],
  paymentMethods: [
    {
      id: CASH_ID,
      shopId: SHOP_ID,
      displayName: 'Cash',
      logicType: 'CASH',
      requiresReconciliation: true,
      active: true,
      sortOrder: 0,
    },
  ],
  deliveryZones: [
    {
      id: ZONE_ID,
      shopId: SHOP_ID,
      name: 'Nasr City',
      feeMinor: moneyMinor(3_000),
      active: true,
      sortOrder: 0,
    },
  ],
};

class MemoryIntakeStore implements OnlineOrderIntakeStore {
  readonly inserted: OnlineOrderPendingInsert[] = [];
  readonly rows = new Map<string, OnlineOrderStoredRequest>();
  readonly catalog: OnlineOrderCatalogAuthority = {
    shop: { id: SHOP_ID, active: true },
    categories: [{ id: CATEGORY_ID, shopId: SHOP_ID, active: true }],
    products: [
      {
        id: PRODUCT_ID,
        shopId: SHOP_ID,
        categoryId: CATEGORY_ID,
        name: 'Canonical Tux Burger',
        priceMinor: 19_000,
        active: true,
        soldOut: false,
        isCombo: false,
      },
    ],
    modifiers: [],
    productModifierLinks: [],
    comboBeverageOptions: [],
  };

  async loadCatalog(shopId: string): Promise<OnlineOrderCatalogAuthority | null> {
    return shopId === SHOP_ID ? this.catalog : null;
  }

  async findByIdempotency(
    shopId: string,
    idempotencyKey: string,
  ): Promise<OnlineOrderStoredRequest | null> {
    return this.rows.get(`${shopId}:${idempotencyKey}`) ?? null;
  }

  async insertPending(record: OnlineOrderPendingInsert): Promise<void> {
    this.inserted.push(record);
    this.rows.set(`${record.shopId}:${record.idempotencyKey}`, {
      id: record.id,
      shopId: record.shopId,
      idempotencyKey: record.idempotencyKey,
      requestSha256: record.requestSha256,
      status: 'PENDING',
    });
  }
}

function menuPayload() {
  return {
    schemaVersion: 1,
    shopId: SHOP_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
    customer: {
      name: 'Ahmed Mohamed',
      phone: '+20 100 123 4567',
      address: 'Nasr City, Cairo',
    },
    fulfillmentPreference: 'DELIVERY',
    paymentPreference: 'CASH',
    items: [
      {
        productId: PRODUCT_ID,
        quantity: 1,
        addonProductIds: [],
        modifierSelections: [],
        comboBeverageProductId: null,
        note: null,
      },
    ],
    orderNote: 'Call on arrival',
  };
}

function intakeRequest(): Request {
  return new Request('https://orders.test/functions/v1/order-intake', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(menuPayload()),
  });
}

function activeSession(): OperationsSessionResult {
  return {
    ok: true,
    value: {
      status: 'ACTIVE',
      shopId: SHOP_ID,
      businessDayId: DAY_ID,
      businessDayStartedAt: AT,
      operator: { id: WORKER_ID, displayName: 'Current Worker' },
    },
  };
}

function whatsappConversation(): WhatsAppConversation {
  return {
    id: CONVERSATION_ID,
    shopId: SHOP_ID,
    normalizedPhone: '00201001234567',
    displayPhone: '+20 100 123 4567',
    customerName: 'Meta Customer',
    context: 'DIRECT',
    linkedOrderId: null,
    unreadCount: 1,
    archived: false,
    followUp: false,
    lastMessageAt: AT,
  };
}

function whatsappStore(): WhatsAppStore {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    upsertRemoteSnapshot: vi.fn().mockResolvedValue(undefined),
    upsertMessage: vi.fn().mockResolvedValue(undefined),
    loadInbox: vi.fn().mockResolvedValue({
      conversations: [whatsappConversation()],
      messages: [],
      quickReplies: [],
      orderLinks: [],
    }),
    listMessages: vi.fn().mockResolvedValue([]),
    saveDraft: vi.fn().mockResolvedValue(undefined),
    getDraft: vi.fn().mockResolvedValue(null),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function sentMessage(outboundIntentKey: string, text: string): WhatsAppMessage {
  return {
    id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    shopId: SHOP_ID,
    conversationId: CONVERSATION_ID,
    providerMessageId: 'wamid.fake.1',
    outboundIntentKey,
    direction: 'OUTBOUND',
    kind: 'TEXT',
    text,
    mediaRef: null,
    media: null,
    location: null,
    status: 'SENT',
    sentByWorkerId: WORKER_ID,
    initiatedByDeviceId: DEVICE_ID,
    initiatedAt: AT,
    createdAt: AT,
  };
}

function fakeWhatsAppRemote(): WhatsAppRemoteGateway {
  const snapshot: WhatsAppInboxSnapshot = {
    conversations: [whatsappConversation()],
    messages: [],
    quickReplies: [],
    orderLinks: [],
    nextCursor: null,
  };
  return {
    loadInbox: vi.fn().mockResolvedValue(snapshot),
    resolveMessagingTarget: vi.fn().mockRejectedValue(new Error('not used')),
    sendText: vi.fn(async (input) => sentMessage(input.outboundIntentKey, input.text)),
    sendMedia: vi.fn().mockRejectedValue(new Error('not used')),
    sendLocation: vi.fn().mockRejectedValue(new Error('not used')),
    sendTemplate: vi.fn().mockRejectedValue(new Error('not used')),
    retryFailedMessage: vi.fn().mockRejectedValue(new Error('not used')),
    getMediaAccess: vi.fn().mockRejectedValue(new Error('not used')),
    markUnread: vi.fn().mockResolvedValue(undefined),
    archive: vi.fn().mockResolvedValue(undefined),
    setFollowUp: vi.fn().mockResolvedValue(undefined),
    linkOrder: vi.fn().mockResolvedValue(undefined),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('Menu → Operations → WhatsApp fake-provider journey', () => {
  it('suppresses duplicate intake, materializes one ONLINE order, resolves the same customer, links it, and replies once', async () => {
    const intakeStore = new MemoryIntakeStore();
    const firstIntake = await handleOrderIntakeRequest(intakeRequest(), intakeStore);
    const retryIntake = await handleOrderIntakeRequest(intakeRequest(), intakeStore);

    expect(firstIntake.status).toBe(202);
    expect(retryIntake.status).toBe(200);
    expect(intakeStore.inserted).toHaveLength(1);
    const pending = intakeStore.inserted[0]!;
    expect(pending.normalizedPhone).toBe(CANONICAL_PHONE);
    expect(pending.itemsSubtotalMinor).toBe(19_000);

    const directory = await mkdtemp(join(tmpdir(), 'tux-menu-ops-wa-'));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, 'operations.sqlite3');
    const database = new SqliteOperationsDatabase(databasePath);
    await database.initialize();
    await database.transaction(async (transaction) => {
      await transaction.shops.put({ id: SHOP_ID, name: 'TUX', active: true });
      await transaction.workers.put({
        id: WORKER_ID,
        shopId: SHOP_ID,
        displayName: 'Current Worker',
        pinHash: 'test-only',
        active: true,
      });
      await transaction.businessDays.put({
        id: DAY_ID,
        shopId: SHOP_ID,
        status: 'OPEN',
        startedAt: AT,
        endedAt: null,
        startedByWorkerId: WORKER_ID,
        endedByWorkerId: null,
        lastAllocatedDisplayOrderNo: 0,
      });
      await transaction.workerSessions.put({
        id: SESSION_ID,
        shopId: SHOP_ID,
        businessDayId: DAY_ID,
        workerId: WORKER_ID,
        startedAt: AT,
        endedAt: null,
      });
      await transaction.configuration.put(CONFIGURATION);
      await transaction.inventory.putItem({
        id: INVENTORY_ID,
        shopId: SHOP_ID,
        name: 'Patty',
        unitLabel: 'unit',
        trackingMode: 'RECIPE_TRACKED',
        active: true,
      });
    });

    const readModel = new SqliteOperatorSessionReadModel(databasePath);
    const draftStore = new SqliteOrderDraftStore(databasePath);
    await draftStore.initialize();
    let sequence = 0;
    const runtime = {
      now: () => AT,
      createUuid: () => `12345678-1234-4123-8123-${String(++sequence).padStart(12, '0')}`,
    };
    const orders = new OperationsOrdersService(
      database,
      readModel,
      draftStore,
      runtime,
      new ApplicationCommandCoordinator(),
      { print: async () => ({ ok: true as const }) },
    );
    const acceptance = new OperationsOnlineOrderAcceptanceService(orders, runtime);
    const claimed: CachedOnlineOrderRequest = {
      requestId: pending.id,
      shopId: SHOP_ID,
      status: 'PROCESSING',
      catalogRevision: pending.catalogRevision,
      fulfillmentPreference: pending.fulfillmentPreference,
      paymentPreference: pending.paymentPreference,
      customerName: pending.customerName,
      normalizedPhone: pending.normalizedPhone,
      deliveryAddress: pending.deliveryAddress,
      trustedItems: pending.trustedItems,
      itemsSubtotalMinor: pending.itemsSubtotalMinor,
      orderNote: pending.orderNote,
      createdAt: AT,
      processingOrderId: RESERVED_ORDER_ID,
      processingStartedAt: AT,
      processingExpiresAt: instant('2026-09-08T23:30:00.000Z'),
      processingDeviceId: DEVICE_ID,
      reservationOriginDeviceId: DEVICE_ID,
    };
    const confirmation = {
      orderTypeId: DELIVERY_TYPE_ID,
      deliveryZoneId: ZONE_ID,
      finalDeliveryFeeMinor: moneyMinor(3_000),
      payment: {
        mode: 'SINGLE' as const,
        methodId: CASH_ID,
        cashReceivedMinor: moneyMinor(25_000),
      },
    };

    const placed = await acceptance.accept(claimed, confirmation);
    const replayed = await acceptance.accept(claimed, confirmation);
    expect(placed.ok).toBe(true);
    expect(replayed.ok).toBe(true);
    if (!placed.ok || !replayed.ok) return;
    expect(placed.value.order.id).toBe(RESERVED_ORDER_ID);
    expect(placed.value.order.source).toBe('ONLINE');
    expect(replayed.value.replayed).toBe(true);

    const remote = fakeWhatsAppRemote();
    const store = whatsappStore();
    const whatsapp = new OperationsWhatsAppService(
      remote,
      store,
      { getState: vi.fn(async () => activeSession()) },
      () => AT,
      database,
    );
    const context = await whatsapp.resolveCustomerOrderContext(CONVERSATION_ID);
    expect(context.ok).toBe(true);
    if (!context.ok) return;
    expect(context.value.kind).toBe('ONE_ACTIVE_ORDER');
    expect(context.value.customer.normalizedPhone).toBe(CANONICAL_PHONE);
    expect(context.value.customer.customerName).toBe('Ahmed Mohamed');
    expect(context.value.activeOrders[0]?.id).toBe(RESERVED_ORDER_ID);

    await expect(
      whatsapp.linkOrder({ conversationId: CONVERSATION_ID, orderId: RESERVED_ORDER_ID }),
    ).resolves.toMatchObject({ ok: true });
    const reply = await whatsapp.sendText({
      conversationId: CONVERSATION_ID,
      text: 'Your TUX order is confirmed.',
      outboundIntentKey: `online-order:${RESERVED_ORDER_ID}:confirmed`,
    });
    expect(reply.ok).toBe(true);
    expect(remote.linkOrder).toHaveBeenCalledTimes(1);
    expect(remote.linkOrder).toHaveBeenCalledWith({
      businessDayId: DAY_ID,
      workerId: WORKER_ID,
      conversationId: CONVERSATION_ID,
      orderId: RESERVED_ORDER_ID,
    });
    expect(remote.sendText).toHaveBeenCalledTimes(1);

    await readModel.close();
    await draftStore.close();
    await database.close();
  });
});