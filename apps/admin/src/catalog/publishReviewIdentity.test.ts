import { describe, expect, it } from 'vitest';
import type { CatalogPublishPreview } from '@tux/admin-contracts';
import { publishReviewIdentity } from './publishReviewIdentity';

const preview: CatalogPublishPreview = {
  shopId: 'shop-a',
  draftId: 'draft-a',
  draftRevision: 1,
  basePublishVersion: 3,
  currentPublishVersion: 3,
  stale: false,
  changedProductIds: ['product-a'],
  priceChangedProductIds: [],
  changedRelationCounts: { productModifierLinks: 0, comboBeverageOptions: 0, recipeLines: 0 },
  changes: [],
};

describe('publish review fingerprint is bound to exact approval subject', () => {
  it('changes with shop, draft, revision, published version and preview content', () => {
    const prior = publishReviewIdentity('shop-a', preview);
    for (const updated of [
      ['shop-b', preview] as const,
      ['shop-a', { ...preview, draftId: 'draft-b' }] as const,
      ['shop-a', { ...preview, draftRevision: 2 }] as const,
      ['shop-a', { ...preview, currentPublishVersion: 4 }] as const,
      ['shop-a', { ...preview, changedProductIds: ['product-b'] }] as const,
    ]) {
      expect(publishReviewIdentity(updated[0], updated[1])).not.toBe(prior);
    }
  });
  it('ignores JSON property ordering without ignoring content', () => {
    const reversed: CatalogPublishPreview = {
      changedRelationCounts: { recipeLines: 0, comboBeverageOptions: 0, productModifierLinks: 0 },
      priceChangedProductIds: [],
      changedProductIds: ['product-a'],
      stale: false,
      currentPublishVersion: 3,
      basePublishVersion: 3,
      draftRevision: 1,
      draftId: 'draft-a',
      shopId: 'shop-a',
      changes: [],
    };
    expect(publishReviewIdentity('shop-a', reversed)).toBe(publishReviewIdentity('shop-a', preview));
  });
});
