import { describe, expect, it, vi } from 'vitest';
import {
  handleOrderIntakeRequest,
  type OnlineOrderCatalogAuthority,
  type OnlineOrderIntakeStore,
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
        priceMinor: 19000,
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

describe('anonymous order-intake bounded capacity', () => {
  it('returns 429 instead of persisting when the trusted store reports the bounded intake limit', async () => {
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
      findByIdempotency: vi.fn().mockResolvedValue(null),
      insertPending: vi.fn().mockRejectedValue({
        message: 'TUX_ONLINE_ORDER_INTAKE_CAPACITY_EXCEEDED',
      }),
    };
    const request = new Request('https://example.test/functions/v1/order-intake', {
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

    const response = await handleOrderIntakeRequest(request, store);

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      schemaVersion: 1,
      error: { code: 'intake_rate_limited' },
    });
  });
});
