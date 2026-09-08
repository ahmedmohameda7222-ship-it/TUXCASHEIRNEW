import type { PublicCatalogSnapshotV1 } from '@tux/catalog-contracts';
import { describe, expect, it } from 'vitest';
import { projectPublicCatalog } from './menuProjection';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const CATEGORY_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333';
const EXTRA_PRODUCT_ID = '44444444-4444-4444-8444-444444444444';
const MODIFIER_ID = '55555555-5555-4555-8555-555555555555';

function snapshot(extraAvailability: { active: boolean; soldOut: boolean }): PublicCatalogSnapshotV1 {
  return {
    schemaVersion: 1,
    shopId: SHOP_ID,
    revision: 'c'.repeat(64),
    categories: [
      {
        id: CATEGORY_ID,
        slug: 'burgers',
        name: 'Burgers',
        description: null,
        active: true,
        sortOrder: 0,
      },
    ],
    products: [
      {
        id: PRODUCT_ID,
        slug: 'burger',
        categoryId: CATEGORY_ID,
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
        slug: 'extra-cheese-product',
        categoryId: CATEGORY_ID,
        name: 'Standalone Cheese Product',
        description: null,
        priceMinor: 2_500,
        imageUrl: null,
        bestSeller: false,
        active: extraAvailability.active,
        soldOut: extraAvailability.soldOut,
        isCombo: false,
        sortOrder: 1,
      },
    ],
    modifiers: [
      {
        id: MODIFIER_ID,
        name: 'Extra cheese',
        priceMinor: 2_500,
        active: true,
        sortOrder: 0,
        standaloneProductId: EXTRA_PRODUCT_ID,
      },
    ],
    productModifierLinks: [
      { productId: PRODUCT_ID, modifierId: MODIFIER_ID, maxQuantity: 1, sortOrder: 0 },
    ],
    comboBeverageOptions: [],
  };
}

describe('canonical Menu linked-extra availability', () => {
  it.each([
    ['inactive', { active: false, soldOut: false }],
    ['sold out', { active: true, soldOut: true }],
  ] as const)(
    'does not offer a linked extra whose standalone product is %s',
    (_label, availability) => {
      const projection = projectPublicCatalog(snapshot(availability));

      expect(projection.extrasByProduct[PRODUCT_ID] ?? []).toEqual([]);
    },
  );
});
