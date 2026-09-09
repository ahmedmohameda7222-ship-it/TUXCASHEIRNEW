import type { PublicCatalogSnapshotV1 } from '@tux/catalog-contracts';
import { describe, expect, it } from 'vitest';
import { projectPublicCatalog } from './menuProjection';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const ACTIVE_CATEGORY_ID = '22222222-2222-4222-8222-222222222222';
const INACTIVE_CATEGORY_ID = '23232323-2323-4232-8232-232323232323';
const BASE_PRODUCT_ID = '33333333-3333-4333-8333-333333333333';
const EXTRA_PRODUCT_ID = '44444444-4444-4444-8444-444444444444';
const MODIFIER_ID = '55555555-5555-4555-8555-555555555555';
const COMBO_ID = '66666666-6666-4666-8666-666666666666';
const BEVERAGE_ID = '77777777-7777-4777-8777-777777777777';

function snapshot(): PublicCatalogSnapshotV1 {
  return {
    schemaVersion: 1,
    shopId: SHOP_ID,
    revision: 'd'.repeat(64),
    categories: [
      {
        id: ACTIVE_CATEGORY_ID,
        slug: 'burgers',
        name: 'Burgers',
        description: null,
        active: true,
        sortOrder: 0,
      },
      {
        id: INACTIVE_CATEGORY_ID,
        slug: 'hidden-drinks',
        name: 'Hidden Drinks',
        description: null,
        active: false,
        sortOrder: 1,
      },
    ],
    products: [
      {
        id: BASE_PRODUCT_ID,
        slug: 'burger',
        categoryId: ACTIVE_CATEGORY_ID,
        name: 'Burger',
        description: null,
        priceMinor: 19_000,
        imageUrl: null,
        bestSeller: false,
        active: true,
        soldOut: false,
        isCombo: false,
        sortOrder: 0,
      },
      {
        id: EXTRA_PRODUCT_ID,
        slug: 'hidden-extra',
        categoryId: INACTIVE_CATEGORY_ID,
        name: 'Hidden Extra Product',
        description: null,
        priceMinor: 2_500,
        imageUrl: null,
        bestSeller: false,
        active: true,
        soldOut: false,
        isCombo: false,
        sortOrder: 1,
      },
      {
        id: COMBO_ID,
        slug: 'combo',
        categoryId: ACTIVE_CATEGORY_ID,
        name: 'Combo',
        description: null,
        priceMinor: 25_000,
        imageUrl: null,
        bestSeller: false,
        active: true,
        soldOut: false,
        isCombo: true,
        sortOrder: 2,
      },
      {
        id: BEVERAGE_ID,
        slug: 'hidden-cola',
        categoryId: INACTIVE_CATEGORY_ID,
        name: 'Hidden Cola',
        description: null,
        priceMinor: 0,
        imageUrl: null,
        bestSeller: false,
        active: true,
        soldOut: false,
        isCombo: false,
        sortOrder: 3,
      },
    ],
    modifiers: [
      {
        id: MODIFIER_ID,
        name: 'Hidden extra',
        priceMinor: 2_500,
        active: true,
        sortOrder: 0,
        standaloneProductId: EXTRA_PRODUCT_ID,
      },
    ],
    productModifierLinks: [
      {
        productId: BASE_PRODUCT_ID,
        modifierId: MODIFIER_ID,
        maxQuantity: 1,
        sortOrder: 0,
      },
    ],
    comboBeverageOptions: [
      { comboProductId: COMBO_ID, beverageProductId: BEVERAGE_ID, sortOrder: 0 },
    ],
  };
}

describe('canonical Menu inactive-category authority for derived choices', () => {
  it('does not expose extras or combo beverages whose referenced product category is inactive', () => {
    const projection = projectPublicCatalog(snapshot());

    expect(projection.extrasByProduct[BASE_PRODUCT_ID] ?? []).toEqual([]);
    expect(projection.comboBeveragesByProduct[COMBO_ID] ?? []).toEqual([]);
    expect(projection.products.find((product) => product.id === COMBO_ID)?.is_active).toBe(false);
  });
});
