import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const baseMigrationPath = 'supabase/migrations/20260910111000_admin_catalog_scheduler.sql';
const hardeningMigrationPath =
  'supabase/migrations/20260910120600_admin_scheduler_retry_hardening.sql';
const baseSql = fs.readFileSync(baseMigrationPath, 'utf8').toLowerCase();
if (!fs.existsSync(hardeningMigrationPath)) {
  throw new Error(
    `catalog scheduler retry hardening migration is missing: ${hardeningMigrationPath}`,
  );
}
const hardeningSql = fs.readFileSync(hardeningMigrationPath, 'utf8').toLowerCase();

for (const required of [
  'claim_due_admin_config_changes_v1',
  'mark_admin_config_change_applied_v1',
  'mark_admin_config_change_failed_v1',
  'for update skip locked',
  'claimed_at',
  'lease',
  'p_attempt_count',
]) {
  if (!baseSql.includes(required))
    throw new Error(`catalog scheduler migration missing ${required}`);
}
for (const required of [
  'next_attempt_at',
  'terminal_failure',
  'p_retryable',
  'p_now',
  'attempt_count < 5',
  'power(2',
]) {
  if (!hardeningSql.includes(required)) {
    throw new Error(`catalog scheduler retry hardening missing ${required}`);
  }
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
const exhaustedScheduleId = '56000000-0000-4000-8000-000000000023';
const freshScheduleId = '56000000-0000-4000-8000-000000000024';

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
  v_next_attempt timestamptz;
  v_terminal boolean;
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
    '2026-09-11 05:00:20+00'::timestamptz, 10, 300
  ) x
  where x.id = '${scheduleId}';
  if v_second_count <> 0 then
    raise exception 'active scheduler lease was claimed twice';
  end if;

  if not public.mark_admin_config_change_failed_v1(
    '${scheduleId}', 'publish:draft-fixture:48', 1, 'fixture transport failure', true,
    '2026-09-11 05:00:00+00'::timestamptz
  ) then
    raise exception 'scheduler failed transition was rejected';
  end if;

  select next_attempt_at, terminal_failure into v_next_attempt, v_terminal
  from public.scheduled_config_changes where id = '${scheduleId}';
  if v_terminal or v_next_attempt <> '2026-09-11 05:00:30+00'::timestamptz then
    raise exception 'retry backoff state invalid: next=%, terminal=%', v_next_attempt, v_terminal;
  end if;

  select count(*) into v_second_count
  from public.claim_due_admin_config_changes_v1(
    '2026-09-11 05:00:29+00'::timestamptz, 10, 300
  ) x
  where x.id = '${scheduleId}';
  if v_second_count <> 0 then
    raise exception 'scheduler retry ignored backoff';
  end if;

  select to_jsonb(x) into v_reclaim
  from public.claim_due_admin_config_changes_v1(
    '2026-09-11 05:00:30+00'::timestamptz, 10, 300
  ) x
  where x.id = '${scheduleId}';
  if v_reclaim is null or (v_reclaim ->> 'attempt_count')::integer <> 2 then
    raise exception 'failed scheduler row was not retryable after backoff: %', v_reclaim;
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
      or next_attempt_at is not null or terminal_failure
    )
  ) then
    raise exception 'scheduler terminal APPLIED state is invalid';
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
  v_terminal boolean;
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
    '${staleScheduleId}', 'availability:fixture:true', 1, 'stale worker failure', true,
    '2026-09-11 05:00:00+00'::timestamptz
  ) then
    raise exception 'stale scheduler failure transition changed a newer claim';
  end if;

  if not public.mark_admin_config_change_failed_v1(
    '${staleScheduleId}', 'availability:fixture:true', 2, 'deterministic failure', false,
    '2026-09-11 05:00:00+00'::timestamptz
  ) then
    raise exception 'current scheduler terminal failure transition was rejected';
  end if;

  select terminal_failure into v_terminal
  from public.scheduled_config_changes where id = '${staleScheduleId}';
  if not v_terminal then
    raise exception 'deterministic scheduler failure was not terminal';
  end if;

  select count(*) into v_count
  from public.claim_due_admin_config_changes_v1(
    '2026-09-12 05:00:00+00'::timestamptz, 10, 300
  ) x
  where x.id = '${staleScheduleId}';
  if v_count <> 0 then
    raise exception 'terminal scheduler failure was reclaimed';
  end if;
end $$;

-- A crashed worker on its fifth allowed attempt becomes terminal when its lease expires.
insert into public.scheduled_config_changes(
  id, business_id, shop_id, created_by_employee_id, change_kind, payload_json,
  timezone, local_scheduled_at, scheduled_for, target_base_publish_version,
  idempotency_key, status, attempt_count, claimed_at
) values (
  '${exhaustedScheduleId}', '${businessId}', '${shopId}', '${employeeId}', 'PRODUCT_AVAILABILITY',
  '{"productId":"46000000-0000-4000-8000-000000000022","soldOut":false}'::jsonb,
  'Africa/Cairo', '2026-09-11 08:00:00', '2026-09-11 05:00:00+00', null,
  'availability:fixture:false', 'CLAIMED', 5, '2026-09-11 04:50:00+00'
);

select count(*) from public.claim_due_admin_config_changes_v1(
  '2026-09-11 05:00:00+00'::timestamptz, 10, 300
);

do $$
begin
  if not exists (
    select 1 from public.scheduled_config_changes
    where id = '${exhaustedScheduleId}'
      and status = 'FAILED'
      and terminal_failure
      and next_attempt_at is null
  ) then
    raise exception 'exhausted crashed claim was not terminalized';
  end if;
end $$;

-- Terminal failures are excluded before LIMIT, so they cannot starve fresh due work.
insert into public.scheduled_config_changes(
  id, business_id, shop_id, created_by_employee_id, change_kind, payload_json,
  timezone, local_scheduled_at, scheduled_for, target_base_publish_version,
  idempotency_key, status, attempt_count, terminal_failure, next_attempt_at
)
select
  ('56000000-0000-4000-8000-' || lpad((100 + n)::text, 12, '0'))::uuid,
  '${businessId}'::uuid, '${shopId}'::uuid, '${employeeId}'::uuid, 'PRODUCT_AVAILABILITY',
  jsonb_build_object('productId', '46000000-0000-4000-8000-000000000099', 'soldOut', true),
  'Africa/Cairo', '2026-09-11 07:00:00'::timestamp, '2026-09-11 04:00:00+00'::timestamptz,
  null, 'terminal:' || n, 'FAILED', 1, true, null
from generate_series(1, 25) n;

insert into public.scheduled_config_changes(
  id, business_id, shop_id, created_by_employee_id, change_kind, payload_json,
  timezone, local_scheduled_at, scheduled_for, target_base_publish_version,
  idempotency_key, status, attempt_count
) values (
  '${freshScheduleId}', '${businessId}', '${shopId}', '${employeeId}', 'PRODUCT_AVAILABILITY',
  '{"productId":"46000000-0000-4000-8000-000000000024","soldOut":true}'::jsonb,
  'Africa/Cairo', '2026-09-11 08:01:00', '2026-09-11 05:01:00+00', null,
  'availability:fresh:true', 'PENDING', 0
);

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.claim_due_admin_config_changes_v1(
    '2026-09-11 05:01:00+00'::timestamptz, 1, 300
  ) x
  where x.id = '${freshScheduleId}';
  if v_count <> 1 then
    raise exception 'terminal failures starved fresh due scheduler work';
  end if;

  if to_regprocedure('public.mark_admin_config_change_failed_v1(uuid,text,integer,text)') is not null then
    raise exception 'legacy scheduler failure RPC overload still exists';
  end if;

  if has_function_privilege(
    'anon',
    'public.claim_due_admin_config_changes_v1(timestamp with time zone,integer,integer)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.claim_due_admin_config_changes_v1(timestamp with time zone,integer,integer)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.mark_admin_config_change_failed_v1(uuid,text,integer,text,boolean,timestamp with time zone)',
    'EXECUTE'
  ) then
    raise exception 'scheduler RPC leaked browser EXECUTE privilege';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.claim_due_admin_config_changes_v1(timestamp with time zone,integer,integer)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.mark_admin_config_change_failed_v1(uuid,text,integer,text,boolean,timestamp with time zone)',
    'EXECUTE'
  ) then
    raise exception 'scheduler RPC missing service_role EXECUTE privilege';
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
