import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const route = readFileSync(new URL('../../api/admin/catalog.ts', import.meta.url), 'utf8');
const panel = readFileSync(
  new URL('../../src/catalog/CatalogCopyPanel.tsx', import.meta.url),
  'utf8',
);

describe('Catalog Copy entity identity preview boundary', () => {
  it('uses a strict authenticated and CSRF-protected Admin API path', () => {
    expect(route).toContain("z.literal('catalog-copy.missing-preview')");
    expect(route).toContain('requireSameOrigin(request, response)');
    expect(route).toContain('loadPrincipal(request, client, true)');
    expect(route).toContain("requirePermission(principal, 'catalog.view', copy.data.sourceShopId)");
    expect(route).toContain("requirePermission(principal, 'catalog.edit', copy.data.targetShopId)");
    expect(route).toContain("'preview_admin_catalog_missing_entities_v1'");
  });

  it('requires source/target scope and version consistency before displaying findings', () => {
    expect(panel).toContain('result.sourceShopId !== activeSourceShopId');
    expect(panel).toContain('result.targetShopId !== targetShopId');
    expect(panel).toContain('result.targetDraftId !== draft.draftId');
    expect(panel).toContain('result.expectedSourcePublishVersion !== source.currentPublishVersion');
    expect(panel).toContain('result.expectedTargetDraftRevision !== draft.draftRevision');
    expect(panel).toContain('Inspect target master mappings');
    expect(panel).toContain("type: 'catalog-copy.missing-preview'");
    expect(panel).toContain('separate publication is required');
    expect(panel).toContain('Stage selected new entities in target draft');
  });
});
