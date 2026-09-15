import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');
const migrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260910121800_admin_plan2_final_review_followup.sql',
);

describe('Plan 2 final review round 5 regressions', () => {
  it('publishes emergency shop flags without leaking staged settings', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toContain(
      'create or replace function public.update_admin_shop_operational_state_v1',
    );
    expect(sql).toContain('v_published_settings_payload');
    expect(sql).toContain('operations_configuration_snapshots');
    expect(sql).toContain("'{snapshot,settings,shopIdentity,temporaryClosed}'");
    expect(sql).toContain("'{snapshot,settings,shopIdentity,onlineOrdersPaused}'");
  });

  it('keeps recurring ENTER blocked behind an unresolved same-boundary EXIT', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toContain(
      'create or replace function public.claim_due_admin_config_changes_v1',
    );
    expect(sql).toContain("blocker.payload_json ->> 'masterProductId'");
    expect(sql).toContain("blocker.payload_json ->> 'transition' = 'EXIT'");
    expect(sql).toContain("blocker.status not in ('APPLIED', 'CANCELLED')");
  });

  it('atomically replaces an older live schedule for the same draft revision', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toContain(
      'create or replace function public.schedule_catalog_draft_v1',
    );
    expect(sql).toContain("s.payload_json ->> 'draftId' = v_draft.id::text");
    expect(sql).toContain(
      "s.payload_json ->> 'expectedDraftRevision' = v_draft.draft_revision::text",
    );
    expect(sql).toContain("s.status in ('PENDING', 'FAILED')");
    expect(sql).toContain("set status = 'CANCELLED'");
    expect(sql).toContain("s.status = 'CLAIMED'");
    expect(sql).toContain("'schedule_in_progress'");
  });
});
