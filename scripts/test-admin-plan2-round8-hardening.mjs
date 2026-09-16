import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const migrationPath =
  'supabase/migrations/20260910122200_admin_plan2_final_review_round8_hardening.sql';
if (!fs.existsSync(migrationPath)) {
  throw new Error(`Plan 2 round 8 hardening migration is missing: ${migrationPath}`);
}

const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();
for (const fragment of [
  'rebase_admin_catalog_draft_transient_v1',
  "'recurring_availability', 'immediate_availability'",
  'resume_catalog_draft_v1',
  'publish_catalog_draft_v1',
  'apply_catalog_draft_change_v1',
  'cancelled_by_draft_edit',
  "s.status in ('pending', 'failed')",
  "'schedule_claimed'",
]) {
  if (!sql.includes(fragment)) {
    throw new Error(`Plan 2 round 8 hardening missing ${fragment}`);
  }
}

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('Plan 2 round 8 hardening static invariant passed.');
  process.exit(0);
}

const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Plan 2 round 8 behavioral test refuses non-loopback PostgreSQL.');
}

const businessId = '00000000-0000-4000-8000-000000000128';
const shopId = '12800000-0000-4000-8000-000000000128';
const employeeId = '22800000-0000-4000-8000-000000000128';
const categoryId = '32800000-0000-4000-8000-000000000128';
const productId = '42800000-0000-4000-8000-000000000128';
const failedScheduleId = '62800000-0000-4000-8000-000000000128';

const behaviorSql = String.raw`
begin;

insert into public.businesses(id, name, timezone, currency_code)
values ('${businessId}', 'Plan 2 Round 8 Fixture', 'Africa/Cairo', 'EGP');
insert into public.shops(id, name, active)
values ('${shopId}', 'Round 8 Shop', true);
insert into public.business_shops(business_id, shop_id)
values ('${businessId}', '${shopId}');
insert into public.business_employees(id, business_id, display_name, role, active)
values ('${employeeId}', '${businessId}', 'Round 8 Owner', 'OWNER', true);
insert into public.menu_categories(id, shop_id, slug, name, sort_order, active)
values ('${categoryId}', '${shopId}', 'round-8', 'Round 8', 0, true);
insert into public.products(
  id, shop_id, category_id, slug, name, description, price_minor,
  active, sold_out, is_combo, sort_order
) values (
  '${productId}', '${shopId}', '${categoryId}', 'round-8-product', 'Round 8 Product',
  'Initial', 1200, true, false, false, 0
);

do $$
declare
  v_create jsonb;
  v_resume jsonb;
  v_publish jsonb;
  v_immediate jsonb;
  v_apply jsonb;
  v_schedule jsonb;
  v_bundle jsonb;
  v_draft_id uuid;
  v_publish_rebase_draft_id uuid;
  v_stale_draft_id uuid;
  v_content_draft_id uuid;
  v_schedule_draft_id uuid;
  v_pending_schedule_id uuid;
  v_claimed_schedule_id uuid;
  v_revision bigint;
begin
  -- Ordinary resume must rebase a persisted DRAFT over transient availability only.
  v_create := public.create_catalog_draft_v1(
    '${employeeId}', '${shopId}', 0, 'Resume after transient availability'
  );
  if coalesce((v_create ->> 'ok')::boolean, false) is not true then
    raise exception 'round 8 resume fixture draft creation failed: %', v_create;
  end if;
  v_draft_id := (v_create ->> 'draftId')::uuid;
  v_bundle := jsonb_set(
    v_create -> 'bundleJson',
    '{snapshot,products,0,description}',
    to_jsonb('Draft description survives rebase'::text),
    false
  );
  v_apply := public.apply_catalog_draft_change_v1(
    '${employeeId}', v_draft_id, 1, jsonb_build_object('bundleJson', v_bundle)
  );
  if coalesce((v_apply ->> 'ok')::boolean, false) is not true then
    raise exception 'round 8 resume fixture draft edit failed: %', v_apply;
  end if;

  v_immediate := public.set_immediate_product_availability_v1(
    '${employeeId}', '${shopId}', '${productId}', true
  );
  if coalesce((v_immediate ->> 'ok')::boolean, false) is not true
     or (v_immediate ->> 'publishVersion')::bigint <> 1 then
    raise exception 'round 8 transient availability fixture failed: %', v_immediate;
  end if;

  v_resume := public.resume_catalog_draft_v1(
    '${employeeId}', '${shopId}', v_draft_id, 1
  );
  if coalesce((v_resume ->> 'ok')::boolean, false) is not true
     or (v_resume ->> 'basePublishVersion')::bigint <> 1
     or v_resume #>> '{bundleJson,snapshot,products,0,soldOut}' <> 'true'
     or v_resume #>> '{bundleJson,snapshot,products,0,description}' <> 'Draft description survives rebase' then
    raise exception 'ordinary persisted draft did not rebase transient availability: %', v_resume;
  end if;

  -- Direct publish must perform the same transient rebase even without a prior resume call.
  v_publish := public.publish_catalog_draft_v1(
    '${employeeId}', v_draft_id, 2, 1
  );
  if coalesce((v_publish ->> 'ok')::boolean, false) is not true
     or (v_publish ->> 'publishVersion')::bigint <> 2 then
    raise exception 'rebased resumed draft did not publish: %', v_publish;
  end if;

  v_create := public.create_catalog_draft_v1(
    '${employeeId}', '${shopId}', 2, 'Direct publish transient rebase'
  );
  v_publish_rebase_draft_id := (v_create ->> 'draftId')::uuid;
  if coalesce((v_create ->> 'ok')::boolean, false) is not true then
    raise exception 'direct publish rebase draft creation failed: %', v_create;
  end if;

  v_immediate := public.set_immediate_product_availability_v1(
    '${employeeId}', '${shopId}', '${productId}', false
  );
  if coalesce((v_immediate ->> 'ok')::boolean, false) is not true
     or (v_immediate ->> 'publishVersion')::bigint <> 3 then
    raise exception 'second transient availability fixture failed: %', v_immediate;
  end if;

  v_publish := public.publish_catalog_draft_v1(
    '${employeeId}', v_publish_rebase_draft_id, 1, 3
  );
  if coalesce((v_publish ->> 'ok')::boolean, false) is not true
     or (v_publish ->> 'publishVersion')::bigint <> 4 then
    raise exception 'ordinary publish did not rebase transient availability: %', v_publish;
  end if;
  if not exists (
    select 1 from public.products p
    where p.id = '${productId}' and p.shop_id = '${shopId}' and p.sold_out = false
  ) then
    raise exception 'ordinary publish resurrected stale soldOut state';
  end if;

  -- A real content publication must remain a hard stale boundary.
  v_create := public.create_catalog_draft_v1(
    '${employeeId}', '${shopId}', 4, 'Must remain stale after content publish'
  );
  v_stale_draft_id := (v_create ->> 'draftId')::uuid;

  v_create := public.create_catalog_draft_v1(
    '${employeeId}', '${shopId}', 4, 'Competing content publish'
  );
  v_content_draft_id := (v_create ->> 'draftId')::uuid;
  v_bundle := jsonb_set(
    v_create -> 'bundleJson',
    '{snapshot,products,0,name}',
    to_jsonb('Round 8 Product Updated'::text),
    false
  );
  v_apply := public.apply_catalog_draft_change_v1(
    '${employeeId}', v_content_draft_id, 1, jsonb_build_object('bundleJson', v_bundle)
  );
  v_publish := public.publish_catalog_draft_v1(
    '${employeeId}', v_content_draft_id, 2, 4
  );
  if coalesce((v_publish ->> 'ok')::boolean, false) is not true
     or (v_publish ->> 'publishVersion')::bigint <> 5 then
    raise exception 'competing content publish failed: %', v_publish;
  end if;

  v_resume := public.resume_catalog_draft_v1(
    '${employeeId}', '${shopId}', v_stale_draft_id, 5
  );
  if v_resume ->> 'code' <> 'stale_version'
     or (v_resume ->> 'currentVersion')::bigint <> 5 then
    raise exception 'real content publication was incorrectly treated as transient: %', v_resume;
  end if;

  -- Editing a scheduled draft invalidates PENDING/FAILED jobs atomically.
  v_create := public.create_catalog_draft_v1(
    '${employeeId}', '${shopId}', 5, 'Scheduled edit invalidation'
  );
  v_schedule_draft_id := (v_create ->> 'draftId')::uuid;
  v_bundle := v_create -> 'bundleJson';

  v_schedule := public.schedule_catalog_draft_v1(
    '${employeeId}', v_schedule_draft_id, 1, 5, timestamp '2099-01-01 12:00:00'
  );
  if coalesce((v_schedule ->> 'ok')::boolean, false) is not true then
    raise exception 'round 8 pending schedule creation failed: %', v_schedule;
  end if;
  v_pending_schedule_id := (v_schedule ->> 'scheduleId')::uuid;

  insert into public.scheduled_config_changes(
    id, business_id, shop_id, created_by_employee_id, change_kind, payload_json,
    timezone, local_scheduled_at, scheduled_for, target_base_publish_version,
    idempotency_key, status, attempt_count, terminal_failure, next_attempt_at, last_error
  )
  select
    '${failedScheduleId}', s.business_id, s.shop_id, s.created_by_employee_id,
    s.change_kind, s.payload_json, s.timezone,
    s.local_scheduled_at + interval '1 minute', s.scheduled_for + interval '1 minute',
    s.target_base_publish_version, 'round8-failed-schedule', 'FAILED', 1, false,
    now() + interval '5 minutes', 'retryable_fixture'
  from public.scheduled_config_changes s
  where s.id = v_pending_schedule_id;

  v_apply := public.apply_catalog_draft_change_v1(
    '${employeeId}', v_schedule_draft_id, 1, jsonb_build_object('bundleJson', v_bundle)
  );
  if coalesce((v_apply ->> 'ok')::boolean, false) is not true
     or (v_apply ->> 'draftRevision')::bigint <> 2 then
    raise exception 'scheduled draft edit failed: %', v_apply;
  end if;
  if exists (
    select 1 from public.scheduled_config_changes s
    where s.id in (v_pending_schedule_id, '${failedScheduleId}'::uuid)
      and (s.status <> 'CANCELLED' or s.last_error <> 'cancelled_by_draft_edit')
  ) then
    raise exception 'scheduled draft edit left a pending/failed job live';
  end if;

  -- Once scheduler execution owns a row, edit must fail closed and preserve the draft revision.
  v_schedule := public.schedule_catalog_draft_v1(
    '${employeeId}', v_schedule_draft_id, 2, 5, timestamp '2099-01-02 12:00:00'
  );
  if coalesce((v_schedule ->> 'ok')::boolean, false) is not true then
    raise exception 'round 8 claimed schedule fixture creation failed: %', v_schedule;
  end if;
  v_claimed_schedule_id := (v_schedule ->> 'scheduleId')::uuid;
  update public.scheduled_config_changes
  set status = 'CLAIMED', claimed_at = now(), attempt_count = 1, updated_at = now()
  where id = v_claimed_schedule_id;

  v_apply := public.apply_catalog_draft_change_v1(
    '${employeeId}', v_schedule_draft_id, 2, jsonb_build_object('bundleJson', v_bundle)
  );
  if v_apply ->> 'code' <> 'schedule_claimed'
     or (v_apply ->> 'scheduleId')::uuid <> v_claimed_schedule_id then
    raise exception 'claimed scheduled publish did not fence draft edit: %', v_apply;
  end if;
  select d.draft_revision into v_revision
  from public.catalog_drafts d where d.id = v_schedule_draft_id;
  if v_revision <> 2 then
    raise exception 'claimed schedule rejection changed the draft revision';
  end if;
end $$;

rollback;
`;

const result = spawnSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-X', '-q'], {
  input: behaviorSql,
  encoding: 'utf8',
});
if (result.status !== 0) {
  process.stderr.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  process.exit(result.status ?? 1);
}

console.log('Plan 2 round 8 hardening PostgreSQL behavior passed.');
