import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('Plan 2 final P2 review regressions', () => {
  it('lets the publish page select every open draft instead of hard-binding draftPreviews[0]', () => {
    const publishReview = source('./PublishReviewPage.tsx');

    expect(publishReview).not.toContain('const preview = data?.draftPreviews[0]');
    expect(publishReview).toContain('Draft to review');
    expect(publishReview).toMatch(/draftPreviews\.map\(/);
  });

  it('includes advanced catalog relations in publish-preview change reporting', () => {
    const contracts = source('../../../../packages/admin-contracts/src/catalog.ts');
    const catalogService = source('../../server/catalog/catalogService.ts');

    expect(contracts).toContain('changedRelationCounts');
    expect(catalogService).toContain("'productModifierLinks'");
    expect(catalogService).toContain("'comboBeverageOptions'");
    expect(catalogService).toContain("'recipeLines'");
    expect(catalogService).toContain('changedRelationCounts');
  });

  it('remounts ProductEditor when any locally editable canonical field refreshes', () => {
    const inspector = source('./ProductInspector.tsx');
    const keyLine = inspector.match(/key=\{`([^`]+)`\}/)?.[1] ?? '';

    expect(keyLine).toContain('${product.description}');
    expect(keyLine).toContain('${product.imageKey}');
    expect(keyLine).toContain('${product.bestSeller}');
  });

  it('captures the reason-code CAS version when the editable form is initialized', () => {
    const reasons = source('../settings/ReasonCodesPage.tsx');

    expect(reasons).toMatch(/useState\(reason\.version\)/);
    expect(reasons).toMatch(/expectedVersion:\s*expectedVersion/);
  });
});
