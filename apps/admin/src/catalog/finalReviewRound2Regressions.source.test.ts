import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function sourceOrEmpty(path: string): string {
  try {
    return source(path);
  } catch {
    return '';
  }
}

describe('Plan 2 fresh final review regressions', () => {
  it('persists service charge and tax in the remote orders projection with an additive schema constraint', () => {
    const materializer = source('../../../../packages/sync/src/remoteMaterializer.ts');
    const migration = sourceOrEmpty(
      '../../../../supabase/migrations/20260910121500_admin_order_charge_sync_hardening.sql',
    );

    expect(materializer).toContain('service_charge_minor');
    expect(materializer).toContain('tax_minor');
    expect(migration).toContain('service_charge_minor');
    expect(migration).toContain('tax_minor');
    expect(migration).toMatch(
      /total_minor\s*=\s*items_subtotal_minor\s*-\s*discount_minor\s*\+\s*final_delivery_fee_minor\s*\+\s*service_charge_minor\s*\+\s*tax_minor/,
    );
  });

  it('enforces published ONLINE weekly and special hours in public availability and trusted intake', () => {
    const authority = source(
      '../../../../supabase/functions/order-intake/published-checkout-authority.ts',
    );
    const intake = source('../../../../supabase/functions/order-intake/order-intake.ts');
    const publicAvailabilityMigration = sourceOrEmpty(
      '../../../../supabase/migrations/20260910121600_catalog_public_online_hours_projection.sql',
    );

    expect(authority).toContain('weeklyHours');
    expect(authority).toContain('specialHours');
    expect(intake).toContain('ONLINE_ORDERING_OUTSIDE_HOURS');
    expect(intake).toContain("serviceKind === 'ONLINE'");
    expect(intake).toContain('Africa/Cairo');
    expect(publicAvailabilityMigration).toContain('catalog_public_online_ordering_open_v1');
    expect(publicAvailabilityMigration).toContain("'Africa/Cairo'");
    expect(publicAvailabilityMigration).toContain("serviceKind");
    expect(publicAvailabilityMigration).toContain(
      'private.catalog_public_online_ordering_open_v1(v_settings, now())',
    );
  });

  it('requires an explicit category selection and defaults it from the product-list category filter', () => {
    const catalogPage = source('./CatalogPage.tsx');

    expect(catalogPage).not.toContain('const category = snapshot.categories[0]');
    expect(catalogPage).toContain('New product category');
    expect(catalogPage).toContain('newProductCategoryId');
    expect(catalogPage).toMatch(/newProductForShop\(shopId,\s*newProductCategoryId/);
    expect(catalogPage).toContain('setNewProductCategoryId(nextCategoryId)');
    expect(catalogPage).toMatch(/onCategoryChange=\{handleCategoryFilterChange\}/);
  });
});
