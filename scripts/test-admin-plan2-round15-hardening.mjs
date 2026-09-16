import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const migrationPath =
  'supabase/migrations/20260910123100_admin_plan2_final_review_round15_hardening.sql';
const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  if (!fs.existsSync(migrationPath)) {
    throw new Error(`Plan 2 round 15 hardening migration is missing: ${migrationPath}`);
  }
  const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();
  for (const fragment of [
    'resolve_admin_cairo_schedule_v1',
    'scheduled_local_time_nonexistent',
    'scheduled_local_time_ambiguous',
    "predecessor.change_kind = 'shop_config'",
    'predecessor.scheduled_for < s.scheduled_for',
    'predecessor.terminal_failure = false',
    'schedule_catalog_draft_v1',
    'schedule_admin_shop_config_v1',
  ]) {
    if (!sql.includes(fragment)) {
      throw new Error(`Plan 2 round 15 hardening missing ${fragment}`);
    }
  }
  console.log('Plan 2 round 15 hardening static invariant passed.');
  process.exit(0);
}

const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Plan 2 round 15 behavioral test refuses non-loopback PostgreSQL.');
}

const businessId = '00000000-0000-4000-8000-000000000150';
const shopId = '15000000-0000-4000-8000-000000000150';
const employeeId = '25000000-0000-4000-8000-000000000150';
const orderTypeId = '35000000-0000-4000-8000-000000000150';
const paymentMethodId = '45000000-0000-4000-8000-000000000150';

const fixtureSql = String.raw`
insert into public.businesses(id, name, timezone, currency_code)
values ('${businessId}', 'Plan 2 Round 15 Fixture', 'Africa/Cairo', 'EGP');
insert into public.shops(id, name, active)
values ('${shopId}', 'Round 15 Shop', true);
insert into public.business_shops(business_id, shop_id)
values ('${businessId}', '${shopId}');
insert into public.business_employees(id, business_id, display_name, role, active)
values ('${employeeId}', '${businessId}', 'Round 15 Owner', 'OWNER', true);
insert into public.order_types(id, shop_id, name, behavior, active, sort_order)
values ('${orderTypeId}', '${shopId}', 'Take Away', 'TAKE_AWAY', true, 0);
insert into public.payment_methods(
  id, shop_id, display_name, logic_type, requires_reconciliation, active, sort_order,
  channel, requires_reference, manual_confirmation_required, refund_allowed
) values (
  '${paymentMethodId}', '${shopId}', 'Cash', 'CASH', true, true, 0,
  'BOTH', false, false, true
);
insert into public.shop_setting_overrides(
  business_id, shop_id, setting_key, value_json, version, updated_by_employee_id
) values (
  '${businessId}', '${shopId}', 'receipt.footer', '"Round 15 baseline"'::jsonb, 1, '${employeeId}'
);
`;

const chronologicalSql = String.raw`
begin;
${fixtureSql}

do $$
declare
  v_result jsonb;
  v_pause jsonb;
  v_resume jsonb;
  v_pause_id uuid;
  v_resume_id uuid;
  v_pause_status text;
  v_resume_status text;
begin
  v_result := public.publish_shop_settings_v1('${employeeId}', '${shopId}', 0);
  if coalesce((v_result ->> 'ok')::boolean, false) is not true
     or (v_result ->> 'settingsVersion')::bigint <> 1 then
    raise exception 'round 15 baseline settings publish failed: %', v_result;
  end if;

  v_pause := public.schedule_shop_online_orders_state_v1(
    '${employeeId}', '${shopId}', true, 1, timestamp '2099-01-03 22:00:00'
  );
  v_resume := public.schedule_shop_online_orders_state_v1(
    '${employeeId}', '${shopId}', false, 1, timestamp '2099-01-03 23:00:00'
  );
  v_pause_id := (v_pause ->> 'scheduleId')::uuid;
  v_resume_id := (v_resume ->> 'scheduleId')::uuid;
  if v_pause_id is null or v_resume_id is null then
    raise exception 'round 15 pause/resume fixture was not accepted: %, %', v_pause, v_resume;
  end if;

  -- Both actions are overdue, but only the earliest unresolved SHOP_CONFIG action may be claimed.
  perform public.claim_due_admin_config_changes_v1(
    timestamptz '2099-01-03 22:00:00+00', 25, 300
  );
  select status into v_pause_status from public.scheduled_config_changes where id = v_pause_id;
  select status into v_resume_status from public.scheduled_config_changes where id = v_resume_id;
  if v_pause_status <> 'CLAIMED' or v_resume_status <> 'PENDING' then
    raise exception 'round 15 same-shop SHOP_CONFIG jobs were not serialized: pause=%, resume=%',
      v_pause_status, v_resume_status;
  end if;

  -- A retryable earlier failure remains unresolved and must continue fencing later actions.
  update public.scheduled_config_changes
  set status = 'FAILED',
      claimed_at = null,
      terminal_failure = false,
      next_attempt_at = timestamptz '2099-01-04 02:00:00+00',
      last_error = 'round15_retryable_fixture',
      updated_at = timestamptz '2099-01-03 22:01:00+00'
  where id = v_pause_id;

  perform public.claim_due_admin_config_changes_v1(
    timestamptz '2099-01-03 22:30:00+00', 25, 300
  );
  select status into v_resume_status from public.scheduled_config_changes where id = v_resume_id;
  if v_resume_status <> 'PENDING' then
    raise exception 'round 15 later SHOP_CONFIG overtook retryable predecessor: %', v_resume_status;
  end if;

  -- Terminal failure is a settled outcome; later chronological work may now advance.
  update public.scheduled_config_changes
  set terminal_failure = true,
      next_attempt_at = null,
      updated_at = timestamptz '2099-01-03 22:31:00+00'
  where id = v_pause_id;

  perform public.claim_due_admin_config_changes_v1(
    timestamptz '2099-01-03 22:32:00+00', 25, 300
  );
  select status into v_resume_status from public.scheduled_config_changes where id = v_resume_id;
  if v_resume_status <> 'CLAIMED' then
    raise exception 'round 15 settled predecessor did not release later SHOP_CONFIG: %', v_resume_status;
  end if;
end $$;

rollback;
`;

const cairoWallClockSql = String.raw`
begin;
${fixtureSql}

do $$
declare
  v_result jsonb;
  v_gap_local timestamp without time zone;
  v_repeat_local timestamp without time zone;
  v_before bigint;
  v_after bigint;
begin
  v_result := public.publish_shop_settings_v1('${employeeId}', '${shopId}', 0);
  if coalesce((v_result ->> 'ok')::boolean, false) is not true then
    raise exception 'round 15 baseline settings publish failed: %', v_result;
  end if;

  select candidate.local_ts into v_gap_local
  from generate_series(
    timestamp '2027-01-01 00:00:00',
    timestamp '2027-12-31 23:45:00',
    interval '15 minutes'
  ) as candidate(local_ts)
  where ((candidate.local_ts at time zone 'Africa/Cairo') at time zone 'Africa/Cairo')
        <> candidate.local_ts
  order by candidate.local_ts
  limit 1;

  select candidate.local_ts into v_repeat_local
  from generate_series(
    timestamp '2027-01-01 00:00:00',
    timestamp '2027-12-31 23:45:00',
    interval '15 minutes'
  ) as candidate(local_ts)
  cross join lateral (
    select candidate.local_ts at time zone 'Africa/Cairo' as instant
  ) mapped
  where ((mapped.instant - interval '1 hour') at time zone 'Africa/Cairo') = candidate.local_ts
     or ((mapped.instant + interval '1 hour') at time zone 'Africa/Cairo') = candidate.local_ts
  order by candidate.local_ts
  limit 1;

  if v_gap_local is null or v_repeat_local is null then
    raise exception 'round 15 timezone fixture could not discover Cairo DST gap/repeat: gap=%, repeat=%',
      v_gap_local, v_repeat_local;
  end if;

  select count(*) into v_before
  from public.scheduled_config_changes
  where shop_id = '${shopId}' and change_kind = 'SHOP_CONFIG';

  v_result := public.schedule_shop_online_orders_state_v1(
    '${employeeId}', '${shopId}', true, 1, v_gap_local
  );
  if v_result ->> 'code' <> 'scheduled_local_time_nonexistent' then
    raise exception 'round 15 nonexistent Cairo local time was not rejected: local=%, result=%',
      v_gap_local, v_result;
  end if;

  v_result := public.schedule_shop_online_orders_state_v1(
    '${employeeId}', '${shopId}', true, 1, v_repeat_local
  );
  if v_result ->> 'code' <> 'scheduled_local_time_ambiguous' then
    raise exception 'round 15 ambiguous Cairo local time was not rejected: local=%, result=%',
      v_repeat_local, v_result;
  end if;

  select count(*) into v_after
  from public.scheduled_config_changes
  where shop_id = '${shopId}' and change_kind = 'SHOP_CONFIG';
  if v_after <> v_before then
    raise exception 'round 15 invalid Cairo local times created durable SHOP_CONFIG rows: before=%, after=%',
      v_before, v_after;
  end if;
end $$;

rollback;
`;

const failures = [];
for (const [label, sql] of [
  ['SHOP_CONFIG chronological claim serialization', chronologicalSql],
  ['Cairo wall-clock validation', cairoWallClockSql],
]) {
  const result = spawnSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-X', '-q'], {
    input: sql,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    failures.push(`${label}:\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exit(1);
}

console.log('Plan 2 round 15 PostgreSQL behavior passed.');
