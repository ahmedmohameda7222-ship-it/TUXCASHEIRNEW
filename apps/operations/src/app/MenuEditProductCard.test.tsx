import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseEntityId, type MenuCategoryId, type Product, type ProductId, type ShopId } from '@tux/domain';
import { MenuEditProductCard } from './MenuEditProductCard';
import { MenuProductCard } from './MenuProductCard';

const product: Product = {
  id: parseEntityId<ProductId>('40000000-0000-4000-8000-000000000010'),
  shopId: parseEntityId<ShopId>('10000000-0000-4000-8000-000000000001'),
  categoryId: parseEntityId<MenuCategoryId>('30000000-0000-4000-8000-000000000001'),
  name: 'Double Smashed Patty',
  description: 'Two smashed patties with cheese.',
  priceMinor: 18000 as Product['priceMinor'],
  imageKey: null,
  family: 'TUX',
  active: true,
  soldOut: false,
  isCombo: false,
  sortOrder: 1,
};

describe('shared Product Card presentation', () => {
  it('renders the same marked product core in normal and edit wrappers', () => {
    const normal = renderToStaticMarkup(
      <MenuProductCard
        product={product}
        quantity={2}
        busy={false}
        onQuickInfo={() => undefined}
        onDecrement={() => undefined}
        onAdd={() => undefined}
        onExtras={() => undefined}
      />,
    );
    const edit = renderToStaticMarkup(
      <MenuEditProductCard product={product} position={2} total={4} />,
    );

    for (const markup of [normal, edit]) {
      expect(markup).toContain('data-product-presentation="true"');
      expect(markup).toContain('data-product-media="true"');
      expect(markup).toContain('Double Smashed Patty');
      expect(markup).toContain('E£180.00');
    }
  });

  it('keeps edit mode free of cashier actions and nested interactive controls', () => {
    const edit = renderToStaticMarkup(
      <MenuEditProductCard product={product} position={2} total={4} />,
    );

    expect(edit).not.toContain('Quick Info');
    expect(edit).not.toContain('Extra');
    expect(edit).not.toContain('Add one');
    expect(edit).not.toContain('Remove one');
    expect(edit).not.toContain('<button');
    expect(edit).toContain('Position 2');
  });
});
