import { describe, expect, it } from 'vitest';

import { createCatalogProductSlug } from './catalogProductSlug';

describe('createCatalogProductSlug', () => {
  it('creates stable unique public slugs from canonical product ids', () => {
    const first = createCatalogProductSlug('11111111-1111-4111-8111-111111111111');
    const second = createCatalogProductSlug('22222222-2222-4222-8222-222222222222');

    expect(first).toBe('product-11111111-1111-4111-8111-111111111111');
    expect(first).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(second).not.toBe(first);
  });

  it('rejects non-canonical product ids', () => {
    expect(() => createCatalogProductSlug('not-a-uuid')).toThrow(/invalid_product_id/);
  });
});
