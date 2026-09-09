import { describe, expect, it } from 'vitest';
import { resolveCanonicalCategoryRoute } from './product-routes';

describe('canonical Menu category route reconciliation', () => {
  it('routes the legacy TUX Burger page to the canonical Burgers/TUX family', () => {
    expect(resolveCanonicalCategoryRoute('tux-burger')).toEqual({
      categorySlug: 'burgers',
      family: 'TUX',
    });
  });

  it('routes the legacy TUXIFY page to the canonical Burgers/TUXIFY family', () => {
    expect(resolveCanonicalCategoryRoute('tuxify')).toEqual({
      categorySlug: 'burgers',
      family: 'TUXIFY',
    });
  });

  it.each(['hawawshi', 'fries', 'combos', 'drinks'])('keeps %s as a normal canonical category route', (slug) => {
    expect(resolveCanonicalCategoryRoute(slug)).toEqual({ categorySlug: slug, family: null });
  });
});
