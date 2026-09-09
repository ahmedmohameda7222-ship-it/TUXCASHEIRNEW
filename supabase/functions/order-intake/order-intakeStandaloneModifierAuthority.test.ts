import { describe, expect, it, vi } from 'vitest';
import {
  handleOrderIntakeRequest,
  type OnlineOrderCatalogAuthority,
  type OnlineOrderIntakeStore,
} from './order-intake';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const CATEGORY_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333';
const ADDON_PRODUCT_ID = '44444444-4444-4444-8444-444444444444';
const MODIFIER_ID = '55555555-5555-4555-8555-555555555555';
const IDEMPOTENCY_KEY = '66666666-6666-4666-8666-666666666666';

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
        priceMinor: 20_000,
        active: true,
        soldOut: false,
        isCombo: false,
      },
      {
        id: ADDON_PRODUCT_ID,
        shopId: SHOP_ID,
        categoryId: CATEGORY_ID,
        name: 'Unavailable Add-on',
        priceMinor: 4_000,
        active: true,
        soldOut: true,
        isCombo: false,
      },
    ],
    modifiers: [
      {
        id: MODIFIER_ID,
        shopId: SHOP_ID,
        name: 'Extra Patty',
        priceMinor: 4_000,
        active: true,
        standaloneProductId: ADDON_PRODUCT_ID,
      },
    ],
    productModifierLinks: [{ productId: PRODUCT_ID, modifierId: MODIFIER_ID, maxQuantity: 1 }],
    comboBeverageOptions: [],
  };
}

describe('order intake standalone modifier authority', () => {
  it('rejects modifierSelections when the modifier backing product is unavailable', async () => {
    const insertPending = vi.fn<OnlineOrderIntakeStore['insertPending']>();
    const store: OnlineOrderIntakeStore = {
      loadCatalog: vi.fn().mockResolvedValue(catalog()),
      findByIdempotency: vi.fn().mockResolvedValue(null),
      insertPending,
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
            modifierSelections: [{ modifierId: MODIFIER_ID, quantity: 1 }],
            comboBeverageProductId: null,
            note: null,
          },
        ],
        orderNote: null,
      }),
    });

    const response = await handleOrderIntakeRequest(request, store);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      schemaVersion: 1,
      error: { code: 'item_unavailable' },
    });
    expect(insertPending).not.toHaveBeenCalled();
  });
});
