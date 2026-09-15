import { describe, expect, it, vi } from 'vitest';
import {
  handleOrderIntakeRequest,
  type OnlineOrderCatalogAuthority,
  type OnlineOrderIntakeStore,
  type OnlineOrderPendingInsert,
  type OnlineOrderStoredRequest,
} from './order-intake';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const CATEGORY_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333';
const IDEMPOTENCY_KEY = '44444444-4444-4444-8444-444444444444';

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

function request(): Request {
  return new Request('https://example.test/functions/v1/order-intake', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      schemaVersion: 1,
      shopId: SHOP_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      customer: { name: 'Pickup Customer', phone: null, address: null },
      fulfillmentPreference: 'PICKUP',
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

describe('order-intake accepted idempotency replay', () => {
  it('returns the original request as a successful replay when the identical attempt is already accepted', async () => {
    let stored: OnlineOrderStoredRequest | null = null;
    const insertPending = vi.fn(async (record: OnlineOrderPendingInsert) => {
      stored = {
        id: record.id,
        shopId: record.shopId,
        idempotencyKey: record.idempotencyKey,
        requestSha256: record.requestSha256,
        status: 'PENDING',
      };
    });
    const store: OnlineOrderIntakeStore = {
      loadCatalog: vi.fn().mockResolvedValue(catalog()),
      loadPublishedCheckoutAuthority: vi.fn().mockResolvedValue({
        shopId: SHOP_ID,
        configurationVersion: 1,
        settingsVersion: null,
        lifecycleState: 'ACTIVE',
        temporaryClosed: false,
        onlineOrdersPaused: false,
        minimumOrderMinor: 0,
        orderTypes: [{ behavior: 'TAKE_AWAY', active: true }],
        paymentMethods: [
          {
            id: '55555555-5555-4555-8555-555555555555',
            displayName: 'Cash',
            logicType: 'CASH',
            active: true,
            channel: 'BOTH',
            integrationReference: null,
          },
        ],
      }),
      findByIdempotency: vi.fn(async () => stored),
      insertPending,
    };

    const initial = await handleOrderIntakeRequest(request(), store);
    expect(initial.status).toBe(202);
    const initialBody = await initial.json();

    if (stored === null) throw new Error('initial request was not persisted');
    stored = { ...stored, status: 'ACCEPTED' };

    const replay = await handleOrderIntakeRequest(request(), store);

    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toEqual({
      schemaVersion: 1,
      requestId: initialBody.requestId,
      status: 'PENDING',
    });
    expect(insertPending).toHaveBeenCalledTimes(1);
  });
});
