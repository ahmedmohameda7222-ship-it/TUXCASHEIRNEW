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

const migration = sourceOrEmpty(
  '../../../../supabase/migrations/20260910122300_admin_plan2_final_review_round9_hardening.sql',
).toLowerCase();
const receiptSequenceStorageMigration = sourceOrEmpty(
  '../../../../supabase/migrations/20260910122400_admin_receipt_sequence_storage_hardening.sql',
).toLowerCase();

describe('Plan 2 final review round 9 regressions', () => {
  it('keeps a scheduled publish valid when resume transient-rebases the same draft', () => {
    expect(migration).toContain('publish_catalog_draft_scheduled_v1');
    expect(migration).toContain("'recurring_availability', 'immediate_availability'");
    expect(migration).toContain('p_expected_base_publish_version');
    expect(migration).toContain('v_draft.base_publish_version');
    expect(migration).toContain('published.publish_version > p_expected_base_publish_version');
  });

  it('requires pricing authority before scheduling either product or modifier price changes', () => {
    expect(migration).toContain('schedule_catalog_draft_v1');
    expect(migration).toContain("v_draft.working_bundle_json -> 'snapshot' -> 'products'");
    expect(migration).toContain("v_draft.working_bundle_json -> 'snapshot' -> 'modifiers'");
    expect(migration).toContain("'catalog.pricing'");
  });

  it('widens remote display-order storage beyond PostgreSQL int4', () => {
    expect(receiptSequenceStorageMigration).toContain('alter table public.business_days');
    expect(receiptSequenceStorageMigration).toContain('last_allocated_display_order_no type bigint');
    expect(receiptSequenceStorageMigration).toContain('alter table public.orders');
    expect(receiptSequenceStorageMigration).toContain('display_order_no type bigint');
  });
});
