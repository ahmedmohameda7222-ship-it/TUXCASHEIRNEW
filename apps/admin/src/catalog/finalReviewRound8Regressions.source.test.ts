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
  '../../../../supabase/migrations/20260910122200_admin_plan2_final_review_round8_hardening.sql',
).toLowerCase();

describe('Plan 2 final review round 8 regressions', () => {
  it('rebases ordinary editable drafts across transient availability publications', () => {
    const catalog = source('./useCatalog.ts');

    expect(migration).toContain('rebase_admin_catalog_draft_transient_v1');
    expect(migration).toContain('resume_catalog_draft_v1');
    expect(migration).toContain('publish_catalog_draft_v1');
    expect(migration).toContain("'recurring_availability', 'immediate_availability'");
    expect(catalog).toContain("workspace.drafts.filter((draft) => draft.status === 'DRAFT')");
  });

  it('invalidates live schedules when their draft revision is edited', () => {
    expect(migration).toContain('apply_catalog_draft_change_v1');
    expect(migration).toContain('cancelled_by_draft_edit');
    expect(migration).toContain("s.status in ('pending', 'failed')");
    expect(migration).toContain("'schedule_claimed'");
  });

  it('filters POS tenders with the trusted channel and delivery-zone predicates', () => {
    const cart = source('../../../operations/src/app/OrdersCart.tsx');

    expect(cart).toContain('paymentMethodSupportsChannel');
    expect(cart).toContain('paymentMethodAllowedForDeliveryZone');
    expect(cart).toContain("paymentMethodSupportsChannel(method, 'POS')");
    expect(cart).toContain('configuration.settings?.paymentMethodZoneRules');
  });

  it('distinguishes terminal schedule failures from retryable failures', () => {
    const contracts = source('../../../../packages/admin-contracts/src/catalog.ts');
    const publishPage = source('./PublishReviewPage.tsx');

    expect(contracts).toContain('terminalFailure: boolean');
    expect(contracts).toContain('nextAttemptAt: string | null');
    expect(publishPage).toContain('schedule.terminalFailure');
    expect(publishPage).toContain('Failed — action required');
  });
});
