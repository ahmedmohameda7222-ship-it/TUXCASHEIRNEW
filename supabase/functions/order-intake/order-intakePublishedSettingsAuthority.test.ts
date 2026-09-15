import { describe, expect, it, vi } from 'vitest';

import {
  calculatePublishedCheckoutPricing,
  handleOrderIntakeRequest,
  isPublishedOnlineOrderingOpenAt,
  type OnlineOrderCatalogAuthority,
  type OnlineOrderIntakeStore,
  type OnlineOrderPendingInsert,
  type OnlineOrderStoredRequest,
} from './order-intake';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const CATEGORY_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333';
const IDEMPOTENCY_KEY = '44444444-4444-4444-8444-444444444444';
const CASH_METHOD_ID = '55555555-5555-4555-8555-555555555555';

type PublishedCheckoutAuthority = {
  shopId: string;
  configurationVersion: number;
  settingsVersion: number | null;
  lifecycleState: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  temporaryClosed: boolean;
  onlineOrdersPaused: boolean;
  minimumOrderMinor: number;
  serviceChargeBps: number;
  taxBps: number;
  requireCustomerPhone: boolean;
  weeklyHours: ReadonlyArray<{
    serviceKind: 'OPEN' | 'DELIVERY' | 'ONLINE';
    dayOfWeek: number;
    timezone: 'Africa/Cairo';
    opensLocal: string;
    closesLocal: string;
    active: boolean;
  }>;
  specialHours: ReadonlyArray<{
    serviceDate: string;
    serviceKind: 'OPEN' | 'DELIVERY' | 'ONLINE';
    timezone: 'Africa/Cairo';
    closed: boolean;
    opensLocal: string | null;
    closesLocal: string | null;
  }>;
  orderTypes: ReadonlyArray<{
    behavior: 'TAKE_AWAY' | 'DINE_IN' | 'DELIVERY' | 'OTHER';
    active: boolean;
  }>;
  paymentMethods: ReadonlyArray<{
    id: string;
    displayName: string;
    logicType: 'CASH' | 'CARD' | 'DIGITAL' | 'OTHER';
    active: boolean;
    channel: 'POS' | 'ONLINE' | 'BOTH';
    integrationReference: string | null;
  }>;
};

function catalog(): OnlineOrderCatalogAuthority {
  return {
    shop: { id: SHOP_ID, active: true },
    categories: [{ id: CATEGORY_ID, shopId: SHOP_ID, active: true }],
    products: [
      {
        id: PRODUCT_ID,
        shopId: SHOP_ID,
        categoryId: CATEGORY_ID,
        name: 'Burger',
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
}

function publishedAuthority(
  overrides: Partial<PublishedCheckoutAuthority> = {},
): PublishedCheckoutAuthority {
  return {
    shopId: SHOP_ID,
    configurationVersion: 7,
    settingsVersion: 3,
    lifecycleState: 'ACTIVE',
    temporaryClosed: false,
    onlineOrdersPaused: false,
    minimumOrderMinor: 0,
    serviceChargeBps: 0,
    taxBps: 0,
    requireCustomerPhone: false,
    weeklyHours: [],
    specialHours: [],
    orderTypes: [
      { behavior: 'TAKE_AWAY', active: true },
      { behavior: 'DELIVERY', active: true },
    ],
    paymentMethods: [
      {
        id: CASH_METHOD_ID,
        displayName: 'Cash',
        logicType: 'CASH',
        active: true,
        channel: 'BOTH',
        integrationReference: null,
      },
    ],
    ...overrides,
  };
}

class MemoryStore implements OnlineOrderIntakeStore {
  readonly inserted: OnlineOrderPendingInsert[] = [];
  readonly rows = new Map<string, OnlineOrderStoredRequest>();

  constructor(readonly published: PublishedCheckoutAuthority) {}

  async loadCatalog(shopId: string): Promise<OnlineOrderCatalogAuthority | null> {
    return shopId === SHOP_ID ? catalog() : null;
  }

  async loadPublishedCheckoutAuthority(shopId: string): Promise<PublishedCheckoutAuthority | null> {
    return shopId === SHOP_ID ? this.published : null;
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

function request(
  overrides: Partial<{
    fulfillmentPreference: 'DELIVERY' | 'PICKUP';
    paymentPreference: 'CASH' | 'INSTAPAY' | 'MIXED';
    customerPhone: string | null;
  }> = {},
): Request {
  return new Request('https://example.test/functions/v1/order-intake', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      schemaVersion: 1,
      shopId: SHOP_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      customer: {
        name: 'Pickup Customer',
        phone: overrides.customerPhone ?? null,
        address: null,
      },
      fulfillmentPreference: overrides.fulfillmentPreference ?? 'PICKUP',
      paymentPreference: overrides.paymentPreference ?? 'CASH',
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
      orderNote: null,
    }),
  });
}

async function errorCode(response: Response): Promise<string> {
  const body = (await response.json()) as { error?: { code?: string } };
  return body.error?.code ?? '';
}

describe('order-intake published checkout settings authority', () => {
  it.each([
    ['SUSPENDED', false, false, 'shop_unavailable'],
    ['ARCHIVED', false, false, 'shop_unavailable'],
    ['ACTIVE', true, false, 'shop_temporarily_closed'],
    ['ACTIVE', false, true, 'online_orders_paused'],
  ] as const)(
    'rejects published shop state %s / temporary=%s / onlinePaused=%s before persistence',
    async (lifecycleState, temporaryClosed, onlineOrdersPaused, expectedCode) => {
      const store = new MemoryStore(
        publishedAuthority({ lifecycleState, temporaryClosed, onlineOrdersPaused }),
      );

      const response = await handleOrderIntakeRequest(request(), store);

      expect(response.status).toBe(409);
      await expect(errorCode(response)).resolves.toBe(expectedCode);
      expect(store.inserted).toHaveLength(0);
    },
  );

  it('enforces published ONLINE weekly hours before persistence', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T10:30:00.000Z')); // Monday 12:30 in Cairo.
    try {
      const store = new MemoryStore(
        publishedAuthority({
          weeklyHours: [
            {
              serviceKind: 'ONLINE',
              dayOfWeek: 1,
              timezone: 'Africa/Cairo',
              opensLocal: '13:00',
              closesLocal: '14:00',
              active: true,
            },
          ],
        }),
      );

      const response = await handleOrderIntakeRequest(request(), store);

      expect(response.status).toBe(409);
      await expect(errorCode(response)).resolves.toBe('online_ordering_outside_hours');
      expect(store.inserted).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies Cairo weekly, overnight, and special ONLINE-hour authority deterministically', () => {
    const weekly = publishedAuthority({
      weeklyHours: [
        {
          serviceKind: 'ONLINE',
          dayOfWeek: 1,
          timezone: 'Africa/Cairo',
          opensLocal: '12:00',
          closesLocal: '13:00',
          active: true,
        },
        {
          serviceKind: 'ONLINE',
          dayOfWeek: 1,
          timezone: 'Africa/Cairo',
          opensLocal: '22:00',
          closesLocal: '02:00',
          active: true,
        },
      ],
    });
    expect(isPublishedOnlineOrderingOpenAt(weekly, new Date('2026-01-05T10:30:00.000Z'))).toBe(
      true,
    );
    expect(isPublishedOnlineOrderingOpenAt(weekly, new Date('2026-01-05T13:00:00.000Z'))).toBe(
      false,
    );
    expect(isPublishedOnlineOrderingOpenAt(weekly, new Date('2026-01-05T23:30:00.000Z'))).toBe(
      true,
    );

    const specialClosed = publishedAuthority({
      weeklyHours: weekly.weeklyHours,
      specialHours: [
        {
          serviceDate: '2026-01-05',
          serviceKind: 'ONLINE',
          timezone: 'Africa/Cairo',
          closed: true,
          opensLocal: null,
          closesLocal: null,
        },
      ],
    });
    expect(
      isPublishedOnlineOrderingOpenAt(specialClosed, new Date('2026-01-05T10:30:00.000Z')),
    ).toBe(false);
  });

  it('enforces the published minimum order against the server-computed trusted subtotal', async () => {
    const store = new MemoryStore(publishedAuthority({ minimumOrderMinor: 20_000 }));

    const response = await handleOrderIntakeRequest(request(), store);

    expect(response.status).toBe(409);
    await expect(errorCode(response)).resolves.toBe('minimum_order_not_met');
    expect(store.inserted).toHaveLength(0);
  });

  it('recomputes published service charge and tax from the trusted server subtotal', () => {
    expect(
      calculatePublishedCheckoutPricing(
        19_000,
        publishedAuthority({ serviceChargeBps: 500, taxBps: 1400 }),
      ),
    ).toEqual({
      itemsSubtotalMinor: 19_000,
      serviceChargeMinor: 950,
      taxMinor: 2_793,
      totalMinor: 22_743,
    });
  });

  it('requires a customer phone for pickup when the published policy enables it', async () => {
    const missingStore = new MemoryStore(publishedAuthority({ requireCustomerPhone: true }));
    const missing = await handleOrderIntakeRequest(request(), missingStore);

    expect(missing.status).toBe(409);
    await expect(errorCode(missing)).resolves.toBe('customer_phone_required');
    expect(missingStore.inserted).toHaveLength(0);

    const presentStore = new MemoryStore(publishedAuthority({ requireCustomerPhone: true }));
    const present = await handleOrderIntakeRequest(
      request({ customerPhone: '01012345678' }),
      presentStore,
    );

    expect(present.status).toBe(202);
    expect(presentStore.inserted[0]?.normalizedPhone).toBe('01012345678');
  });

  it('rejects an ONLINE cash intent when the published cash method is POS-only', async () => {
    const store = new MemoryStore(
      publishedAuthority({
        paymentMethods: [
          {
            id: CASH_METHOD_ID,
            displayName: 'Cash',
            logicType: 'CASH',
            active: true,
            channel: 'POS',
            integrationReference: null,
          },
        ],
      }),
    );

    const response = await handleOrderIntakeRequest(request(), store);

    expect(response.status).toBe(409);
    await expect(errorCode(response)).resolves.toBe('payment_method_unavailable');
    expect(store.inserted).toHaveLength(0);
  });

  it('rejects a fulfillment preference that is not active in the published order types', async () => {
    const store = new MemoryStore(
      publishedAuthority({ orderTypes: [{ behavior: 'DELIVERY', active: true }] }),
    );

    const response = await handleOrderIntakeRequest(
      request({ fulfillmentPreference: 'PICKUP' }),
      store,
    );

    expect(response.status).toBe(409);
    await expect(errorCode(response)).resolves.toBe('fulfillment_unavailable');
    expect(store.inserted).toHaveLength(0);
  });

  it('keeps an active published policy compatible with the existing intake contract', async () => {
    const store = new MemoryStore(publishedAuthority());

    const response = await handleOrderIntakeRequest(request(), store);

    expect(response.status).toBe(202);
    expect(store.inserted).toHaveLength(1);
  });
});
