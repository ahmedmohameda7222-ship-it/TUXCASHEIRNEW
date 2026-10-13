import { describe, expect, it } from 'vitest';

import {
  catalogCopyPreviewMatchesSelection,
  type CatalogCopyCurrentSelection,
  type CatalogCopyPreviewBinding,
} from './catalogCopyPreviewGuard';

const current: CatalogCopyCurrentSelection = {
  sourceShopId: 'source-shop',
  targetShopId: 'target-shop',
  targetDraftId: 'draft-1',
  targetPublishVersion: 12,
  targetDraftRevision: 4,
  selectedDomains: ['productOrder', 'categoryAvailability'],
};

const preview: CatalogCopyPreviewBinding = {
  sourceShopId: current.sourceShopId,
  targetShopId: current.targetShopId,
  targetDraftId: current.targetDraftId!,
  expectedTargetPublishVersion: current.targetPublishVersion,
  expectedTargetDraftRevision: current.targetDraftRevision!,
  selectedDomains: [...current.selectedDomains],
};

describe('Catalog Copy preview binding', () => {
  it('allows staging only with the exact previewed source, target, draft, revision and domains', () => {
    expect(catalogCopyPreviewMatchesSelection(preview, current)).toBe(true);
    expect(catalogCopyPreviewMatchesSelection(null, current)).toBe(false);
  });

  it.each([
    { sourceShopId: 'another-source' },
    { targetShopId: 'another-target' },
    { targetDraftId: 'draft-2' },
    { targetDraftId: null },
    { targetPublishVersion: 13 },
    { targetDraftRevision: 5 },
    { targetDraftRevision: null },
    { selectedDomains: ['categoryAvailability', 'productOrder'] },
    { selectedDomains: ['productOrder'] },
    { selectedDomains: ['productOrder', 'categoryAvailability', 'productPrices'] },
    { sourceShopId: 'target-shop' },
  ])('rejects stale or mismatched selection %j', (override) => {
    expect(catalogCopyPreviewMatchesSelection(preview, { ...current, ...override })).toBe(false);
  });
});
