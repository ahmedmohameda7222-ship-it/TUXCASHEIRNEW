import fs from 'node:fs';

const migrationPath =
  'supabase/migrations/20260910122300_admin_plan2_final_review_round9_hardening.sql';
if (!fs.existsSync(migrationPath)) {
  throw new Error(`Plan 2 round 9 hardening migration is missing: ${migrationPath}`);
}

const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();
for (const fragment of [
  'publish_catalog_draft_scheduled_v1',
  "'recurring_availability', 'immediate_availability'",
  'published.publish_version > p_expected_base_publish_version',
  'schedule_catalog_draft_v1',
  "v_draft.working_bundle_json -> 'snapshot' -> 'products'",
  "v_draft.working_bundle_json -> 'snapshot' -> 'modifiers'",
  "'catalog.pricing'",
]) {
  if (!sql.includes(fragment)) {
    throw new Error(`Plan 2 round 9 hardening missing ${fragment}`);
  }
}

console.log('Plan 2 round 9 hardening static invariant passed.');
