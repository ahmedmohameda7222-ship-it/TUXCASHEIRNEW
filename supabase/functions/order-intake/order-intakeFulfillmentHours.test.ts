import { describe, expect, it, vi } from 'vitest';

import {
  handleOrderIntakeRequest,
  type OnlineOrderCatalogAuthority,
  type OnlineOrderIntakeStore,
  type OnlineOrderPendingInsert,
  type OnlineOrderPublishedCheckoutAuthority,
  type OnlineOrderStoredRequest,
} from './order-intake';

const SHOP_ID = '11111111-1111-4111-8111-111111111161';
const CATEGORY_ID = '22222222-2222-4222-8222-222222222161';
const PRODUCT_ID = '33333333-3333-4333-8333-333333333161';
const CASH_METHOD_ID = '44444444-4444-4444-8444-444444444161';

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

function authority(
  weeklyHours: OnlineOrderPublishedCheckoutAuthority['weeklyHours'],
): OnlineOrderPublishedCheckoutAuthority {
  return {
    shopId: SHOP_ID,
    configurationVersion: 16,
    settingsVersion: 16,
    lifecycleState: 'ACTIVE',
    temporaryClosed: false,
    onlineOrdersPaused: false,
    minimumOrderMinor: 0,
    serviceChargeBps: 0,
    taxBps: 0,
    requireCustomerPhone: false,
    weeklyHours,
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
  };
}

class MemoryStore implements OnlineOrderIntakeStore {
  readonly inserted: OnlineOrderPendingInsert[] = [];
  readonly rows = new Map<string, OnlineOrderStoredRequest>();

  constructor(readonly published: OnlineOrderPublishedCheckoutAuthority) {}

  async loadCatalog(shopId: string): Promise<OnlineOrderCatalogAuthority | null> {
    return shopId === SHOP_ID ? catalog() : null;
  }

  async loadPublishedCheckoutAuthority(
    shopId: string,
  ): Promise<OnlineOrderPublishedCheckoutAuthority | null> {
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

function request(fulfillmentPreference: 'DELIVERY' | 'PICKUP', keySuffix: string): Request {
  return new Request('https://example.test/functions/v1/order-intake', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      schemaVersion: 1,
      shopId: SHOP_ID,
      idempotencyKey: `55555555-5555-4555-8555-555555555${keySuffix}`,
      customer: {
        name: 'Round 16 Customer',
        phone: fulfillmentPreference === 'DELIVERY' ? '01012345678' : null,
        address: fulfillmentPreference === 'DELIVERY' ? 'Maadi, Cairo' : null,
      },
      fulfillmentPreference,
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
      orderNote: null,
    }),
  });
}

async function errorCode(response: Response): Promise<string> {
  const body = (await response.json()) as { error?: { code?: string } };
  return body.error?.code ?? '';
}

const onlineOpen = {
  serviceKind: 'ONLINE' as const,
  dayOfWeek: 1,
  timezone: 'Africa/Cairo' as const,
  opensLocal: '12:00',
  closesLocal: '14:00',
  active: true,
};

describe('order-intake fulfillment-specific service-hour authority', () => {
  it('rejects DELIVERY while ONLINE is open but DELIVERY hours are closed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T10:30:00.000Z')); // Monday 12:30 Cairo.
    try {
      const store = new MemoryStore(
        authority([
          onlineOpen,
          {
            serviceKind: 'DELIVERY',
            dayOfWeek: 1,
            timezone: 'Africa/Cairo',
            opensLocal: '13:00',
            closesLocal: '14:00',
            active: true,
          },
        ]),
      );

      const response = await handleOrderIntakeRequest(request('DELIVERY', '161'), store);

      expect(response.status).toBe(409);
      await expect(errorCode(response)).resolves.toBe('fulfillment_outside_hours');
      expect(store.inserted).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects PICKUP while ONLINE is open but OPEN hours are closed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T10:30:00.000Z')); // Monday 12:30 Cairo.
    try {
      const store = new MemoryStore(
        authority([
          onlineOpen,
          {
            serviceKind: 'OPEN',
            dayOfWeek: 1,
            timezone: 'Africa/Cairo',
            opensLocal: '13:00',
            closesLocal: '14:00',
            active: true,
          },
        ]),
      );

      const response = await handleOrderIntakeRequest(request('PICKUP', '162'), store);

      expect(response.status).toBe(409);
      await expect(errorCode(response)).resolves.toBe('fulfillment_outside_hours');
      expect(store.inserted).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts when ONLINE and the applicable fulfillment window are both open', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T10:30:00.000Z')); // Monday 12:30 Cairo.
    try {
      const store = new MemoryStore(
        authority([
          onlineOpen,
          {
            serviceKind: 'DELIVERY',
            dayOfWeek: 1,
            timezone: 'Africa/Cairo',
            opensLocal: '12:00',
            closesLocal: '14:00',
            active: true,
          },
        ]),
      );

      const response = await handleOrderIntakeRequest(request('DELIVERY', '163'), store);

      expect(response.status).toBe(202);
      expect(store.inserted).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
