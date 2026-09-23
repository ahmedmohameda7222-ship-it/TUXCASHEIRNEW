import { describe, expect, it, vi } from 'vitest';

import {
  handleOrderIntakeRequest,
  type OnlineOrderCatalogAuthority,
  type OnlineOrderIntakeStore,
  type OnlineOrderPendingInsert,
  type OnlineOrderPublishedCheckoutAuthority,
  type OnlineOrderStoredRequest,
} from './order-intake';

const SHOP_ID = '11111111-1111-4111-8111-111111111191';
const CATEGORY_ID = '22222222-2222-4222-8222-222222222191';
const PRODUCT_ID = '33333333-3333-4333-8333-333333333191';
const CASH_METHOD_ID = '44444444-4444-4444-8444-444444444191';
const FALLBACK_SHOP_ID = '11111111-1111-4111-8111-111111111192';
const IDEMPOTENCY_KEY = '55555555-5555-4555-8555-555555555191';

function catalog(shopId = SHOP_ID): OnlineOrderCatalogAuthority {
  return {
    shop: { id: shopId, active: true },
    categories: [{ id: CATEGORY_ID, shopId, active: true }],
    products: [{
      id: PRODUCT_ID, shopId, categoryId: CATEGORY_ID, name: 'Delivery Burger',
      priceMinor: 19_000, active: true, soldOut: false, isCombo: false,
    }],
    modifiers: [], productModifierLinks: [], comboBeverageOptions: [],
  };
}

function authority(shopId = SHOP_ID): OnlineOrderPublishedCheckoutAuthority {
  return {
    shopId, configurationVersion: 19, settingsVersion: 19,
    lifecycleState: 'ACTIVE', temporaryClosed: false, onlineOrdersPaused: false,
    minimumOrderMinor: 0, serviceChargeBps: 0, taxBps: 0, requireCustomerPhone: false,
    weeklyHours: [], specialHours: [],
    orderTypes: [{ behavior: 'DELIVERY', active: true }],
    paymentMethods: [{
      id: CASH_METHOD_ID, displayName: 'Cash', logicType: 'CASH', active: true,
      channel: 'BOTH', integrationReference: null,
    }],
  };
}

class MemoryStore implements OnlineOrderIntakeStore {
  readonly inserted: OnlineOrderPendingInsert[] = [];
  readonly rows = new Map<string, OnlineOrderStoredRequest>();
  readonly resolveDeliveryRoute = vi.fn();

  async loadCatalog(shopId: string) {
    return shopId === SHOP_ID || shopId === FALLBACK_SHOP_ID ? catalog(shopId) : null;
  }
  async loadPublishedCheckoutAuthority(shopId: string) {
    return shopId === SHOP_ID || shopId === FALLBACK_SHOP_ID ? authority(shopId) : null;
  }
  async findByIdempotency(shopId: string, idempotencyKey: string) {
    return this.rows.get(`${shopId}:${idempotencyKey}`) ?? null;
  }
  async insertPending(record: OnlineOrderPendingInsert): Promise<void> {
    this.inserted.push(record);
    this.rows.set(`${record.shopId}:${record.idempotencyKey}`, {
      id: record.id, shopId: record.shopId, idempotencyKey: record.idempotencyKey,
      requestSha256: record.requestSha256, status: 'PENDING',
    });
  }
}

function request(includeLocation: boolean): Request {
  return new Request('https://example.test/functions/v1/order-intake', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      schemaVersion: 1, shopId: SHOP_ID, idempotencyKey: IDEMPOTENCY_KEY,
      customer: { name: 'Delivery Customer', phone: '01012345678', address: 'Maadi, Cairo' },
      fulfillmentPreference: 'DELIVERY', paymentPreference: 'CASH',
      items: [{
        productId: PRODUCT_ID, quantity: 1, addonProductIds: [], modifierSelections: [],
        comboBeverageProductId: null, note: null,
      }],
      orderNote: null,
      ...(includeLocation ? { deliveryLocation: { latitude: 29.9602, longitude: 31.2569 } } : {}),
    }),
  });
}

async function errorCode(response: Response): Promise<string> {
  const body = (await response.json()) as { error?: { code?: string } };
  return body.error?.code ?? '';
}

describe('order-intake trusted delivery routing authority', () => {
  it('fails closed when DELIVERY has no geographic location for canonical zone resolution', async () => {
    const store = new MemoryStore();
    const response = await handleOrderIntakeRequest(request(false), store);
    expect(response.status).toBe(409);
    await expect(errorCode(response)).resolves.toBe('delivery_location_required');
    expect(store.resolveDeliveryRoute).not.toHaveBeenCalled();
    expect(store.inserted).toHaveLength(0);
  });

  it('rejects delivery when the trusted resolver says the location is unavailable', async () => {
    const store = new MemoryStore();
    store.resolveDeliveryRoute.mockResolvedValue({ ok: false, code: 'delivery_unavailable' });
    const response = await handleOrderIntakeRequest(request(true), store);
    expect(response.status).toBe(409);
    await expect(errorCode(response)).resolves.toBe('delivery_unavailable');
    expect(store.resolveDeliveryRoute).toHaveBeenCalledWith(expect.objectContaining({
      requestedShopId: SHOP_ID, latitude: 29.9602, longitude: 31.2569, subtotalMinor: 19_000,
    }));
    expect(store.inserted).toHaveLength(0);
  });

  it('persists only the trusted zone, fee and minimum returned by the server', async () => {
    const store = new MemoryStore();
    store.resolveDeliveryRoute.mockResolvedValue({
      ok: true, shopId: SHOP_ID, zoneId: '66666666-6666-4666-8666-666666666191',
      zoneName: 'Maadi Core', feeMinor: 3_000, minimumOrderMinor: 15_000, fallbackUsed: false,
    });
    const response = await handleOrderIntakeRequest(request(true), store);
    expect(response.status).toBe(202);
    expect(store.inserted).toHaveLength(1);
    expect(store.inserted[0]).toMatchObject({
      shopId: SHOP_ID, deliveryZoneId: '66666666-6666-4666-8666-666666666191',
      deliveryFeeMinor: 3_000, deliveryMinimumOrderMinor: 15_000, deliveryFallbackUsed: false,
    });
  });

  it('accepts an explicit trusted fallback only after revalidating the resolved shop', async () => {
    const store = new MemoryStore();
    store.resolveDeliveryRoute.mockResolvedValue({
      ok: true,
      shopId: FALLBACK_SHOP_ID,
      zoneId: '66666666-6666-4666-8666-666666666192',
      zoneName: 'Fallback Core',
      feeMinor: 3_500,
      minimumOrderMinor: 15_000,
      fallbackUsed: true,
    });

    const response = await handleOrderIntakeRequest(request(true), store);

    expect(response.status).toBe(202);
    expect(store.inserted).toHaveLength(1);
    expect(store.inserted[0]).toMatchObject({
      requestedShopId: SHOP_ID,
      shopId: FALLBACK_SHOP_ID,
      deliveryZoneId: '66666666-6666-4666-8666-666666666192',
      deliveryFeeMinor: 3_500,
      deliveryFallbackUsed: true,
    });
    expect(store.resolveDeliveryRoute).toHaveBeenCalledTimes(2);
  });
});
