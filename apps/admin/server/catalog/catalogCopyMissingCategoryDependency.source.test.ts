import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL(
    '../../../../supabase/migrations/20261015020000_admin_catalog_copy_missing_category_dependency.sql',
    import.meta.url,
  ),
  'utf8',
).toLowerCase();

describe('Trusted Catalog Copy Preview Category dependency', () => {
  it('reports missing target Category even when the Product identity is mapped', () => {
    const missingCategory = [
      'when target_category.master_category_id is null',
      "then 'missing_target_category'",
    ].join(' ');
    const mappedProduct = [
      'when target_binding.master_product_id is not null',
      "then 'mapped'",
    ].join(' ');
    expect(sql).toContain(missingCategory);
    expect(sql).toContain(mappedProduct);
    expect(sql.indexOf(missingCategory)).toBeLessThan(sql.indexOf(mappedProduct));
  });

  it('keeps source/target/draft fencing and service-only execution', () => {
    expect(sql).toContain('stale_catalog_copy_preview');
    expect(sql).toContain('stale_draft_revision');
    expect(sql).toContain('cross_business_copy_forbidden');
    expect(sql).toContain('revoke all on function public.preview_admin_catalog_missing_entities_v1');
    expect(sql).toContain('to service_role');
    expect(sql).not.toContain('insert into public.products');
    expect(sql).not.toContain('insert into public.menu_categories');
    expect(sql).not.toContain('drop table');
  });
});
