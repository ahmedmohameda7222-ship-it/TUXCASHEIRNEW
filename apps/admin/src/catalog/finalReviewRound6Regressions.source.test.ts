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

const finalMigrationPath =
  '../../../../supabase/migrations/20260910122000_admin_plan2_final_acceptance_hardening.sql';

describe('Plan 2 final acceptance review regressions', () => {
  it('rebases scheduled drafts across both recurring and immediate transient availability publishes', () => {
    const migration = sourceOrEmpty(finalMigrationPath);

    expect(migration).toContain('publish_catalog_draft_scheduled_v1');
    expect(migration).toContain("'RECURRING_AVAILABILITY', 'IMMEDIATE_AVAILABILITY'");
    expect(migration).toContain("'{soldOut}'");
  });

  it('blocks ENTER behind every earlier unresolved same-product EXIT', () => {
    const migration = sourceOrEmpty(finalMigrationPath);

    expect(migration).toContain('claim_due_admin_config_changes_v1');
    expect(migration).toContain('predecessor.scheduled_for <= s.scheduled_for');
    expect(migration).toContain("predecessor.status not in ('APPLIED', 'CANCELLED')");
  });

  it('executes already-authorized recurring occurrences under scheduler authority', () => {
    const migration = sourceOrEmpty(finalMigrationPath);

    expect(migration).toContain('apply_recurring_product_availability_v1');
    expect(migration).toContain('v_business_id := v_rule.business_id;');
    expect(migration).toContain('published_by_employee_id');
  });

  it('resumes persisted editable drafts after a page reload', () => {
    const contracts = source('../../../../packages/admin-contracts/src/catalog.ts');
    const api = source('../../api/admin/catalog.ts');
    const hook = source('./useCatalog.ts');

    expect(contracts).toContain("type: 'draft.resume'");
    expect(api).toContain("type: z.literal('draft.resume')");
    expect(hook).toContain("type: 'draft.resume'");
  });

  it('provides version-fenced weekly and special service-hours mutations', () => {
    const contracts = source('../../../../packages/admin-contracts/src/settings.ts');
    const api = source('../../api/admin/settings.ts');
    const shops = source('../settings/ShopsPage.tsx');
    const migration = sourceOrEmpty(finalMigrationPath);

    expect(contracts).toContain("type: 'shop.weekly-hours.upsert'");
    expect(contracts).toContain("type: 'shop.special-hours.upsert'");
    expect(api).toContain("type: z.literal('shop.weekly-hours.upsert')");
    expect(api).toContain("type: z.literal('shop.special-hours.upsert')");
    expect(shops).toContain('Save weekly hours');
    expect(shops).toContain('Save special hours');
    expect(migration).toContain('upsert_admin_shop_weekly_hours_v1');
    expect(migration).toContain('upsert_admin_shop_special_hours_v1');
  });

  it('provides a validated version-fenced canonical shop identity mutation', () => {
    const contracts = source('../../../../packages/admin-contracts/src/settings.ts');
    const api = source('../../api/admin/settings.ts');
    const shops = source('../settings/ShopsPage.tsx');
    const migration = sourceOrEmpty(finalMigrationPath);

    expect(contracts).toContain("type: 'shop.identity.update'");
    expect(api).toContain("type: z.literal('shop.identity.update')");
    expect(shops).toContain('Save shop identity');
    expect(migration).toContain('update_admin_shop_identity_v1');
  });

  it('does not advertise an unenforced refund policy control', () => {
    const payments = source('../settings/PaymentsPage.tsx');

    expect(payments).not.toContain('<span>Refund allowed</span>');
    expect(payments).not.toContain('<span>Refund blocked</span>');
    expect(payments).not.toContain('checked={draft.refundAllowed}');
  });
});
