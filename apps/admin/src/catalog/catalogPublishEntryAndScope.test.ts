import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const catalog = readFileSync(resolve(import.meta.dirname, 'CatalogPage.tsx'), 'utf8');

describe('Catalog shop-scoped publishing entry point', () => {
  it('makes Review & Publish discoverable from the main Catalog screen', () => {
    expect(catalog).toContain('href="/catalog/products/publishing"');
    expect(catalog).toContain('Review & Publish');
    expect(catalog).toContain('catalog.compatibleDrafts.length');
    expect(catalog).toContain('currentPublishVersion');
    expect(catalog).toContain('Save Draft');
    expect(catalog).toContain('Publish Now');
  });

  it('does not render another shop\'s unsaved product while scope changes', () => {
    expect(catalog).toContain('unsavedProduct?.shopId === shopId');
    expect(catalog).toContain('product.shopId === shopId');
    expect(catalog).toContain('setUnsavedProduct(null)');
  });

  it('offers a clear next action after saving a product draft', () => {
    expect(catalog).toContain('Draft saved');
    expect(catalog).toContain('Review & Publish');
  });
});
