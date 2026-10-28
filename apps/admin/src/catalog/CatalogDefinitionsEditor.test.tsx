import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CatalogDefinitionsEditor } from './CatalogDefinitionsEditor';

const categories = [
  {
    id: 'cat-a',
    shopId: 'shop',
    slug: 'burgers',
    name: 'Burgers',
    description: null,
    sortOrder: 10,
    active: true,
  },
];
const modifiers = [
  { id: 'mod-a', shopId: 'shop', name: 'Cheese', priceMinor: 200, sortOrder: 10, active: true },
];

describe('catalog category/modifier management', () => {
  it('offers create controls and edit/archive affordances in the catalog draft', () => {
    const html = renderToStaticMarkup(
      <CatalogDefinitionsEditor
        shopId="shop"
        categories={categories}
        modifiers={modifiers}
        canEdit
        canPrice
        pending={false}
        onSave={vi.fn()}
      />,
    );
    expect(html).toContain('Add category');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('Edit Burgers');
    expect(html).not.toContain('Edit Cheese');
    expect(html).toContain('Draft');
  });
  it('renders direct accessible reorder/edit/archive controls without a hidden overflow menu', () => {
    const html = renderToStaticMarkup(
      <CatalogDefinitionsEditor
        shopId="shop"
        categories={categories}
        modifiers={modifiers}
        canEdit
        canPrice
        pending={false}
        onSave={vi.fn()}
      />,
    );
    expect(html).toContain('aria-label="Move up Burgers"');
    expect(html).toContain('aria-label="Move down Burgers"');
    expect(html).toContain('aria-label="Edit Burgers"');
    expect(html).toContain('aria-label="Archive Burgers"');
    expect(html).not.toContain('<details');
  });

  it('does not render categories from another shop even if the upstream payload is mixed', () => {
    const html = renderToStaticMarkup(
      <CatalogDefinitionsEditor
        shopId="shop"
        categories={[
          ...categories,
          { ...categories[0]!, id: 'other-shop-category', shopId: 'other-shop', name: 'Private' },
        ]}
        modifiers={modifiers}
        canEdit
        canPrice
        pending={false}
        onSave={vi.fn()}
      />,
    );
    expect(html).toContain('Burgers');
    expect(html).not.toContain('Private');
  });

  it('C2 renders explicit desktop category status and position columns', () => {
    const html = renderToStaticMarkup(
      <CatalogDefinitionsEditor
        shopId="shop"
        categories={categories}
        modifiers={modifiers}
        canEdit
        canPrice
        pending={false}
        onSave={vi.fn()}
      />,
    );
    expect(html).toContain('data-catalog-definition-columns="categories"');
    expect(html).toContain('>Category</span>');
    expect(html).toContain('>Status</span>');
    expect(html).toContain('>Position</span>');
    expect(html).toContain('class="admin-catalog-definition-status');
    expect(html).toContain('class="admin-catalog-definition-position');
  });

  it('does not expose mutating actions without catalog.edit', () => {
    const html = renderToStaticMarkup(
      <CatalogDefinitionsEditor
        shopId="shop"
        categories={categories}
        modifiers={modifiers}
        canEdit={false}
        canPrice={false}
        pending={false}
        onSave={vi.fn()}
      />,
    );
    expect(html).not.toContain('Add category');
    expect(html).not.toContain('Add modifier');
  });
});
