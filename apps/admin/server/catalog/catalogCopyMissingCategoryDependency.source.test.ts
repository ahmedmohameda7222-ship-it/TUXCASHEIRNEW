import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL(
    '../../../../supabase/migrations/20261015020000_admin_catalog_copy_missing_category_dependency.sql',
    import.meta.url,
  ),
  'utf8',
).toLowerCase();

describe('Catalog Copy target Category dependency', () => {
  it('detects Category gaps before mapped Product acceptance', () => {
    const categoryBranch = 'when target_category.master_category_id is null';
    const productBranch = 'when target_binding.master_product_id is not null';

    expect(sql).toContain(`${categoryBranch} then 'missing_target_category'`);
    expect(sql).toContain(`${productBranch} then 'mapped'`);
    expect(sql.indexOf(categoryBranch)).toBeLessThan(sql.indexOf(productBranch));
  });

  it('preserves version fencing and service-role-only execution', () => {
    const rpc = 'public.preview_admin_catalog_missing_entities_v1';
    expect(sql).toContain('stale_catalog_copy_preview');
    expect(sql).toContain('stale_draft_revision');
    expect(sql).toContain('cross_business_copy_forbidden');
    expect(sql).toContain(`revoke all on function ${rpc}`);
    expect(sql).toContain('to service_role');
    expect(sql).not.toContain('insert into public.products');
    expect(sql).not.toContain('insert into public.menu_categories');
    expect(sql).not.toContain('drop table');
  });
});
