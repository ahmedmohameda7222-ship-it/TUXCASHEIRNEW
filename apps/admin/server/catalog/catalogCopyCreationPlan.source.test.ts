import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL(
    '../../../../supabase/migrations/20261015070000_admin_catalog_copy_creation_proposal.sql',
    import.meta.url,
  ),
  'utf8',
).toLowerCase();

describe('Catalog Copy explicit missing-entity creation proposal', () => {
  it('offers stable target-local identities without using matching display names', () => {
    expect(sql).toContain('proposedtargetcategoryid');
    expect(sql).toContain('proposedtargetproductid');
    expect(sql).toContain('creationfingerprint');
    expect(sql).toContain('sha256(');
  });

  it('binds proposal identity to source publication and target draft state', () => {
    expect(sql).toContain('p_source_publish_version');
    expect(sql).toContain('p_target_publish_version');
    expect(sql).toContain('p_target_draft_revision');
    expect(sql).toContain('missing_target_category');
  });
});
