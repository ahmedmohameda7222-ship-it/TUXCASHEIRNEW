import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL(
    '../../../../supabase/migrations/20261015011203_admin_catalog_copy_missing_entity_preview.sql',
    import.meta.url,
  ),
  'utf8',
).toLowerCase();

describe('Catalog Copy missing-entity diagnostic preview', () => {
  it('uses canonical scoped source/target authority and version fencing', () => {
    expect(sql).toContain('preview_admin_catalog_missing_entities_v1');
    expect(sql).toContain('assert_admin_catalog_permission_v1');
    expect(sql).toContain('p_source_publish_version');
    expect(sql).toContain('p_target_publish_version');
    expect(sql).toContain('p_target_draft_revision');
    expect(sql).toContain('stale_catalog_copy_preview');
  });

  it('treats matching names as conflicts, never as implicit identity mappings', () => {
    expect(sql).toContain('catalog_master_categories');
    expect(sql).toContain('catalog_master_products');
    expect(sql).toContain('catalog_category_shop_bindings');
    expect(sql).toContain('catalog_product_shop_overrides');
    expect(sql).toContain('conflict_name');
    expect(sql).toContain('missing_source_master');
  });

  it('keeps the read-only diagnostic RPC service-role-only', () => {
    expect(sql).toContain(
      'revoke all on function public.preview_admin_catalog_missing_entities_v1',
    );
    expect(sql).toContain('to service_role');
    expect(sql).not.toContain('insert into public.menu_categories');
    expect(sql).not.toContain('insert into public.products');
    expect(sql).not.toContain('update public.products');
    expect(sql).not.toContain('drop table');
  });
});
