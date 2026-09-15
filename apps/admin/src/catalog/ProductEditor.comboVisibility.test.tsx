import type { CatalogJsonObject, CatalogProductDetail } from '@tux/admin-contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ProductEditor } from './ProductEditor';

const product: CatalogProductDetail = {
  id: '11111111-1111-4111-8111-111111111111',
  shopId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  categoryId: '22222222-2222-4222-8222-222222222222',
  slug: 'classic-smash',
  name: 'Classic Smash',
  description: null,
  priceMinor: 1550,
  imageKey: null,
  family: 'burger',
  bestSeller: false,
  active: true,
  soldOut: false,
  isCombo: false,
  sortOrder: 10,
};

const advancedBundle: CatalogJsonObject = {
  snapshot: {
    products: [
      {
        id: product.id,
        shopId: product.shopId,
        name: product.name,
        active: true,
        sortOrder: 10,
      },
      {
        id: '55555555-5555-4555-8555-555555555555',
        shopId: product.shopId,
        name: 'Water',
        active: true,
        sortOrder: 20,
      },
    ],
    modifiers: [],
    productModifierLinks: [],
    comboBeverageOptions: [],
    recipeLines: [],
  },
  inventoryItems: [],
};

describe('ProductEditor combo controls', () => {
  it('does not advertise combo options for a non-combo product', () => {
    const html = renderToStaticMarkup(
      <ProductEditor
        product={product}
        canEdit
        canPrice
        initialAdvancedOpen
        advancedBundle={advancedBundle}
        onSaveDraft={vi.fn()}
        onSetAvailability={vi.fn()}
      />,
    );

    expect(html).not.toContain('Combo Options');
    expect(html).not.toContain('Water');
  });

  it('shows combo options for a combo product', () => {
    const html = renderToStaticMarkup(
      <ProductEditor
        product={{ ...product, isCombo: true }}
        canEdit
        canPrice
        initialAdvancedOpen
        advancedBundle={advancedBundle}
        onSaveDraft={vi.fn()}
        onSetAvailability={vi.fn()}
      />,
    );

    expect(html).toContain('Combo Options');
    expect(html).toContain('Water');
  });
});
