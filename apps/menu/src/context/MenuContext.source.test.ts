import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./MenuContext.tsx', import.meta.url), 'utf8');

describe('MenuContext published checkout propagation', () => {
  it('exposes the V2 public shop and checkout policy from the same catalog snapshot', () => {
    expect(source).toContain("import type { PublicCatalogShopV2 } from '@tux/catalog-contracts';");
    expect(source).toContain("from '@/lib/published-checkout-policy';");
    expect(source).toContain('shop: PublicCatalogShopV2 | null;');
    expect(source).toContain('checkoutPolicy: PublishedCheckoutPolicy | null;');
    expect(source).toContain('setShop(snapshot.shop);');
    expect(source).toContain('setCheckoutPolicy(projectPublishedCheckoutPolicy(snapshot.ordering));');
  });

  it('fails closed when the canonical public snapshot cannot be loaded', () => {
    expect(source).toContain('setShop(null);');
    expect(source).toContain('setCheckoutPolicy(null);');
  });
});
