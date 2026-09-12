import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const migrationPath = 'supabase/migrations/20260910111000_admin_catalog_scheduler.sql';
const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();

for (const required of [
  'claim_due_admin_config_changes_v1',
  'mark_admin_config_change_applied_v1',
  'mark_admin_config_change_failed_v1',
  'for update skip locked',
  'claimed_at',
  'lease',
  'p_attempt_count',
]) {
  if (!sql.includes(required)) throw new Error(`catalog scheduler migration missing ${required}`);
}

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('Admin catalog scheduler migration static invariant passed.');
  process.exit(0);
}

const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Admin catalog scheduler behavioral test refuses non-loopback PostgreSQL.');
}

const businessId = '00000000-0000-4000-8000-000000000021';
const shopId = '16000000-0000-4000-8000-000000000021';
const employeeId = '26000000-0000-4000-8000-000000000021';
const scheduleId = '56000000-0000-4000-8000-000000000021';
const staleScheduleId = '56000000-0000-4000-8000-000000000022';

const behaviorSql = String.raw`
begin;

insert into public.businesses(id, name)
values ('${businessId}', 'Scheduler Fixture Business');

insert into public.shops(id, name, active)
values ('${shopId}', 'Scheduler Fixture Shop', true);

insert into public.business_shops(business_id, shop_id)
values ('${businessId}', '${shopId}');

insert into public.business_employees(id, business_id, display_name, role, active)
values ('${employeeId}', '${businessId}', 'Scheduler Fixture Owner', 'OWNER', true);

insert into public.scheduled_config_changes(
  id, business_id, shop_id, created_by_employee_id, change_kind, payload_json,
  timezone, local_scheduled_at, scheduled_for, target_base_publish_version,
  idempotency_key, status, attempt_count
) values (
  '${scheduleId}', '${businessId}', '${shopId}', '${employeeId}', 'CATALOG_PUBLISH',
  '{"draftId":"draft-fixture","expectedDraftRevision":3}'::jsonb,
  'Africa/Cairo', '2026-09-11 08:00:00', '2026-09-11 05:00:00+00', 48,
  'publish:draft-fixture:48', 'PENDING', 0
);

do $$
declare
  v_claim jsonb;
  v_second_count integer;
  v_reclaim jsonb;
begin
  select to_jsonb(x) into v_claim
  from public.claim_due_admin_config_changes_v1(
    '2026-09-11 05:00:00+00'::timestamptz, 10, 300
  ) x
  where x.id = '${scheduleId}';

  if v_claim is null
     or v_claim ->> 'change_kind' <> 'CATALOG_PUBLISH'
     or (v_claim ->> 'attempt_count')::integer <> 1 then
    raise exception 'scheduler due claim failed: %', v_claim;
  end if;

  select count(*) into v_second_count
  from public.claim_due_admin_config_changes_v1(
    '2026-09-11 05:00:30+00'::timestamptz, 10, 300
  ) x
  where x.id = '${scheduleId}';
  if v_second_count <> 0 then
    raise exception 'active scheduler lease was claimed twice';
  end if;

  if not public.mark_admin_config_change_failed_v1(
    '${scheduleId}', 'publish:draft-fixture:48', 1, 'fixture failure'
  ) then
    raise exception 'scheduler failed transition was rejected';
  end if;

  select to_jsonb(x) into v_reclaim
  from public.claim_due_admin_config_changes_v1(
    '2026-09-11 05:01:00+00'::timestamptz, 10, 300
  ) x
  where x.id = '${scheduleId}';
  if v_reclaim is null or (v_reclaim ->> 'attempt_count')::integer <> 2 then
    raise exception 'failed scheduler row was not retryable: %', v_reclaim;
  end if;

  if public.mark_admin_config_change_applied_v1(
    '${scheduleId}', 'publish:draft-fixture:48', 1, '{"ok":true,"publishVersion":48}'::jsonb
  ) then
    raise exception 'stale scheduler attempt was allowed to complete a newer claim';
  end if;

  if not public.mark_admin_config_change_applied_v1(
    '${scheduleId}', 'publish:draft-fixture:48', 2, '{"ok":true,"publishVersion":49}'::jsonb
  ) then
    raise exception 'scheduler applied transition was rejected';
  end if;

  if exists (
    select 1 from public.scheduled_config_changes
    where id = '${scheduleId}' and (
      status <> 'APPLIED' or applied_at is null or claimed_at is not null
    )
  ) then
    raise exception 'scheduler terminal APPLIED state is invalid';
  end if;

  select count(*) into v_second_count
  from public.claim_due_admin_config_changes_v1(
    '2026-09-11 06:00:00+00'::timestamptz, 10, 300
  ) x
  where x.id = '${scheduleId}';
  if v_second_count <> 0 then
    raise exception 'applied scheduler row was claimed again';
  end if;
end $$;

insert into public.scheduled_config_changes(
  id, business_id, shop_id, created_by_employee_id, change_kind, payload_json,
  timezone, local_scheduled_at, scheduled_for, target_base_publish_version,
  idempotency_key, status, attempt_count, claimed_at
) values (
  '${staleScheduleId}', '${businessId}', '${shopId}', '${employeeId}', 'PRODUCT_AVAILABILITY',
  '{"productId":"46000000-0000-4000-8000-000000000021","soldOut":true}'::jsonb,
  'Africa/Cairo', '2026-09-11 08:00:00', '2026-09-11 05:00:00+00', null,
  'availability:fixture:true', 'CLAIMED', 1, '2026-09-11 04:50:00+00'
);

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.claim_due_admin_config_changes_v1(
    '2026-09-11 05:00:00+00'::timestamptz, 10, 300
  ) x
  where x.id = '${staleScheduleId}' and x.attempt_count = 2;
  if v_count <> 1 then
    raise exception 'stale scheduler lease was not reclaimed';
  end if;

  if public.mark_admin_config_change_failed_v1(
    '${staleScheduleId}', 'availability:fixture:true', 1, 'stale worker failure'
  ) then
    raise exception 'stale scheduler failure transition changed a newer claim';
  end if;

  if not public.mark_admin_config_change_failed_v1(
    '${staleScheduleId}', 'availability:fixture:true', 2, 'current worker failure'
  ) then
    raise exception 'current scheduler failure transition was rejected';
  end if;

  if has_function_privilege(
    'anon',
    'public.claim_due_admin_config_changes_v1(timestamp with time zone,integer,integer)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.claim_due_admin_config_changes_v1(timestamp with time zone,integer,integer)',
    'EXECUTE'
  ) then
    raise exception 'scheduler claim RPC leaked browser EXECUTE privilege';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.claim_due_admin_config_changes_v1(timestamp with time zone,integer,integer)',
    'EXECUTE'
  ) then
    raise exception 'scheduler claim RPC missing service_role EXECUTE privilege';
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

console.log('Admin catalog scheduler PostgreSQL behavior passed.');
