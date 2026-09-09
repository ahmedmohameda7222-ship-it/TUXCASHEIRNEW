import { describe, expect, it, vi } from 'vitest';
import {
  handleOrderIntakeRequest,
  type OnlineOrderCatalogAuthority,
  type OnlineOrderIntakeStore,
} from './order-intake';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const CATEGORY_ID = '22222222-2222-4222-8222-222222222222';
const COMBO_ID = '33333333-3333-4333-8333-333333333333';
const IDEMPOTENCY_KEY = '44444444-4444-4444-8444-444444444444';

function comboCatalogWithoutBeverages(): OnlineOrderCatalogAuthority {
  return {
    shop: { id: SHOP_ID, active: true },
    categories: [{ id: CATEGORY_ID, shopId: SHOP_ID, active: true }],
    products: [
      {
        id: COMBO_ID,
        shopId: SHOP_ID,
        categoryId: CATEGORY_ID,
        name: 'Combo One',
        priceMinor: 25_000,
        active: true,
        soldOut: false,
        isCombo: true,
      },
    ],
    modifiers: [],
    productModifierLinks: [],
    comboBeverageOptions: [],
  };
}

describe('order intake combo beverage authority', () => {
  it('rejects a combo that omits a beverage even when the catalog has zero beverage-option rows', async () => {
    const insertPending = vi.fn<OnlineOrderIntakeStore['insertPending']>();
    const store: OnlineOrderIntakeStore = {
      loadCatalog: vi.fn().mockResolvedValue(comboCatalogWithoutBeverages()),
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
            productId: COMBO_ID,
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

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      schemaVersion: 1,
      error: { code: 'invalid_selection' },
    });
    expect(insertPending).not.toHaveBeenCalled();
  });
});
