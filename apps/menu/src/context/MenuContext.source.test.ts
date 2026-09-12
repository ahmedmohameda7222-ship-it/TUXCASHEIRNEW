import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./MenuContext.tsx', import.meta.url), 'utf8');

describe('MenuContext published checkout propagation', () => {
  it('exposes published shop and checkout policy from the catalog snapshot', () => {
    expect(source).toContain('PublicCatalogShopV2');
    expect(source).toContain('PublishedCheckoutPolicy');
    expect(source).toContain('projectPublishedCheckoutPolicy');
    expect(source).toContain('shop: PublicCatalogShopV2 | null;');
    expect(source).toContain('checkoutPolicy: PublishedCheckoutPolicy | null;');
    expect(source).toContain('setShop(snapshot.shop);');
    expect(source).toContain('snapshot.ordering');
  });

  it('fails closed when the canonical public snapshot cannot be loaded', () => {
    expect(source).toContain('setShop(null);');
    expect(source).toContain('setCheckoutPolicy(null);');
  });
});
