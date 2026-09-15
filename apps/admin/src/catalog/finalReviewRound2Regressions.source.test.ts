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

  it('enforces published ONLINE weekly and special hours at trusted online intake', () => {
    const authority = source(
      '../../../../supabase/functions/order-intake/published-checkout-authority.ts',
    );
    const intake = source('../../../../supabase/functions/order-intake/order-intake.ts');

    expect(authority).toContain('weeklyHours');
    expect(authority).toContain('specialHours');
    expect(intake).toContain('ONLINE_ORDERING_OUTSIDE_HOURS');
    expect(intake).toContain("serviceKind === 'ONLINE'");
    expect(intake).toContain('Africa/Cairo');
  });

  it('requires an explicit category selection when creating a product', () => {
    const catalogPage = source('./CatalogPage.tsx');

    expect(catalogPage).not.toContain('const category = snapshot.categories[0]');
    expect(catalogPage).toContain('New product category');
    expect(catalogPage).toContain('newProductCategoryId');
    expect(catalogPage).toMatch(/categoryId:\s*newProductCategoryId/);
  });
});
