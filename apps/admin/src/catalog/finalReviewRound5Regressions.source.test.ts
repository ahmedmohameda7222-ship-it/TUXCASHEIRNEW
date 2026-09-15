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
    expect(sql).toContain('select snapshot.version, snapshot.bundle_json');
    expect(sql).toContain("v_previous_bundle #> '{snapshot,settings}'");
    expect(sql).toContain("'{temporaryClosed}'");
    expect(sql).toContain("'{onlineOrdersPaused}'");
    expect(sql).toContain("'{shopIdentity}'");
    expect(sql).toContain("'{snapshot,settings}'");
    expect(sql).toContain('v_settings_payload := jsonb_build_object');
    expect(sql).not.toContain('publish_shop_settings_v1(');
  });

  it('keeps recurring ENTER blocked behind an unresolved same-boundary EXIT', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('create or replace function public.claim_due_admin_config_changes_v1');
    expect(sql).toContain("s.payload_json ->> 'transition' <> 'ENTER'");
    expect(sql).toContain('predecessor.scheduled_for = s.scheduled_for');
    expect(sql).toContain("predecessor.payload_json ->> 'masterProductId'");
    expect(sql).toContain("predecessor.payload_json ->> 'transition' = 'EXIT'");
    expect(sql).toContain("predecessor.status not in ('APPLIED', 'CANCELLED')");
  });

  it('atomically replaces an older live schedule for the same draft revision', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('create or replace function public.schedule_catalog_draft_v1');
    expect(sql).toContain("s.payload_json ->> 'draftId' = v_draft.id::text");
    expect(sql).toContain(
      "(s.payload_json ->> 'expectedDraftRevision')::bigint = v_draft.draft_revision",
    );
    expect(sql).toContain("s.status in ('PENDING', 'FAILED', 'CLAIMED')");
    expect(sql).toContain('for update;');
    expect(sql).toContain("if v_existing_live_status = 'CLAIMED' then");
    expect(sql).toContain("'code', 'schedule_claimed'");
    expect(sql).toContain("set status = 'CANCELLED'");
    expect(sql).toContain("last_error = 'replaced_by_reschedule'");
  });
});
