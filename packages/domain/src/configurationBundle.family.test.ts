import { describe, expect, it } from 'vitest';
import { parseOperationsConfigurationBundle } from './configurationBundle';

const shopId = '11111111-1111-4111-8111-111111111111';
const categoryId = '22222222-2222-4222-8222-222222222222';
const productId = '33333333-3333-4333-8333-333333333333';

function bundle(product: Record<string, unknown>) {
  return {
    snapshot: {
      shopId,
      version: 2,
      updatedAt: '2026-08-21T00:20:00.000Z',
      categories: [
        {
          id: categoryId,
          shopId,
          name: 'Burgers',
          sortOrder: 0,
          active: true,
        },
      ],
      products: [
        {
          id: productId,
          shopId,
          categoryId,
          name: 'Single Smashed Patty',
          description: null,
          priceMinor: 12_000,
          imageKey: null,
          active: true,
          soldOut: false,
          isCombo: false,
          sortOrder: 0,
          ...product,
        },
      ],
      modifiers: [],
      productModifierLinks: [],
      comboBeverageOptions: [],
      recipeLines: [],
      orderTypes: [],
      paymentMethods: [],
      deliveryZones: [],
    },
    inventoryItems: [],
  };
}

describe('Operations configuration product family', () => {
  it('preserves an explicit product family', () => {
    const parsed = parseOperationsConfigurationBundle(bundle({ family: 'TUX' }));
    expect(parsed.snapshot.products[0]?.family).toBe('TUX');
  });

  it('keeps older configuration snapshots compatible when family is absent', () => {
    const parsed = parseOperationsConfigurationBundle(bundle({}));
    expect(parsed.snapshot.products[0]?.family).toBeNull();
  });

  it('rejects an empty family label', () => {
    expect(() => parseOperationsConfigurationBundle(bundle({ family: '   ' }))).toThrow(
      'product family must be a non-empty string',
    );
  });
});
