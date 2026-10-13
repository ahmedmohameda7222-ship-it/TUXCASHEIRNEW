import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { catalogCopySchema } from '../../api/admin/catalog';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../supabase/migrations');
const id = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const thirdId = '33333333-3333-4333-8333-333333333333';

const command = {
  type: 'catalog-copy.preview',
  sourceShopId: id,
  targetShopId: secondId,
  targetDraftId: thirdId,
  expectedSourcePublishVersion: 1,
  expectedTargetPublishVersion: 1,
  expectedTargetDraftRevision: 1,
  selectedDomains: ['productOrder'],
};

describe('selective master-mapped product ordering', () => {
  it('accepts a selected product ordering domain and rejects duplicate selections', () => {
    expect(catalogCopySchema.safeParse(command).success).toBe(true);
    expect(
      catalogCopySchema.safeParse({
        ...command,
        selectedDomains: ['productOrder', 'productOrder'],
      }).success,
    ).toBe(false);
  });

  it('accepts product-category reassignment as a separate selected catalog copy domain', () => {
    expect(
      catalogCopySchema.safeParse({
        ...command,
        selectedDomains: ['productCategoryAssignments'],
      }).success,
    ).toBe(true);
  });

  it('preserves source/target identity mapping when copying product-category relationships', () => {
    const sql = readFileSync(
      join(root, '20261013022832_admin_catalog_copy_product_category_assignments.sql'),
      'utf8',
    );
    expect(sql).toContain("'productCategoryAssignments'");
    expect(sql).toContain('v_assignment_map');
    expect(sql).toContain('catalog_copy_missing_target_dependencies');
    expect(sql).toContain('private.validate_admin_catalog_bundle_v1');
  });

  it('allows explicitly selected combo beverage copy with full target-product mapping', () => {
    expect(
      catalogCopySchema.safeParse({
        ...command,
        selectedDomains: ['comboBeverageOptions'],
      }).success,
    ).toBe(true);
    const sql = readFileSync(
      join(root, '20261013040000_admin_catalog_copy_combo_beverage_options.sql'),
      'utf8',
    );
    expect(sql).toContain('v_source_to_target_product_map');
    expect(sql).toContain('changedComboBeverageOptions');
    expect(sql).toContain('catalog_copy_missing_target_dependencies');
    expect(sql).toContain('private.validate_admin_catalog_bundle_v1');
  });

  it('copies only target sortOrder through the fingerprinted draft and preserves identity', () => {
    const names = readdirSync(root).filter((name) =>
      name.endsWith('_admin_catalog_copy_existing_master_product_order.sql'),
    );
    expect(names).toHaveLength(1);
    const sql = readFileSync(join(root, names[0]!), 'utf8');
    expect(sql).toContain("'productOrder'");
    expect(sql).toContain("'{sortOrder}'");
    expect(sql).toContain('private.validate_admin_catalog_bundle_v1');
    expect(sql).toContain('stale_catalog_copy_preview');
    expect(sql).toContain('public.apply_admin_catalog_shop_copy_v1');
  });
});
