import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const api = readFileSync(new URL('../../api/admin/catalog.ts', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../../src/catalog/CatalogCopyPanel.tsx', import.meta.url), 'utf8');

describe('Catalog Copy missing target-local Category/Product Stage boundary', () => {
  it('exposes only a strict CSRF and permission-protected explicit selection', () => {
    expect(api).toContain("z.literal('catalog-copy.stage-created-entities')");
    expect(api).toContain("'stage_admin_catalog_copy_created_entities_v1'");
    expect(api).toContain("requirePermission(principal, 'catalog.pricing', copy.data.targetShopId)");
    expect(api).toContain('selectedSourceCategoryIds');
    expect(api).toContain('selectedSourceProductIds');
    expect(api).toContain('creationFingerprint');
    expect(api).toContain('requireSameOrigin(request, response)');
  });

  it('requires selection and an immutable preview before staging a target Draft', () => {
    expect(panel).toContain('Stage selected new entities in target draft');
    expect(panel).toContain('selectedSourceCategoryIds');
    expect(panel).toContain('selectedSourceProductIds');
    expect(panel).toContain('missingCreationCommandId');
    expect(panel).toContain('creationFingerprint: currentMissingPreview.creationFingerprint');
    expect(panel).toContain('publish separately');
  });
});
