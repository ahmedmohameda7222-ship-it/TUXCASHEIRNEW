import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const migrationPath =
  'supabase/migrations/20260910123200_admin_plan2_final_review_round16_hardening.sql';
const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  if (!fs.existsSync(migrationPath)) {
    throw new Error(`Plan 2 round 16 hardening migration is missing: ${migrationPath}`);
  }
  const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();
  for (const fragment of [
    'schedule_admin_shop_config_v1_pre_round15',
    'p_settings_payload::text',
    'sha256',
    'materialize_recurring_availability_changes_v1',
    'resolve_admin_cairo_schedule_v1',
    'recurring_dst_occurrence_skipped',
  ]) {
    if (!sql.includes(fragment)) {
      throw new Error(`Plan 2 round 16 hardening missing ${fragment}`);
    }
  }
  console.log('Plan 2 round 16 hardening static invariant passed.');
  process.exit(0);
}

const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Plan 2 round 16 behavioral test refuses non-loopback PostgreSQL.');
}

const businessId = '00000000-0000-4000-8000-000000000160';
const shopId = '16000000-0000-4000-8000-000000000160';
const employeeId = '26000000-0000-4000-8000-000000000160';
const orderTypeId = '36000000-0000-4000-8000-000000000160';
const paymentMethodId = '46000000-0000-4000-8000-000000000160';
const masterCategoryId = '56000000-0000-4000-8000-000000000160';
const masterProductId = '66000000-0000-4000-8000-000000000160';
const gapRuleId = '76000000-0000-4000-8000-000000000160';
const repeatRuleId = '86000000-0000-4000-8000-000000000160';

const fixtureSql = String.raw`
insert into public.businesses(id, name, timezone, currency_code)
values ('${businessId}', 'Plan 2 Round 16 Fixture', 'Africa/Cairo', 'EGP');
insert into public.shops(id, name, active)
values ('${shopId}', 'Round 16 Shop', true);
insert into public.business_shops(business_id, shop_id)
values ('${businessId}', '${shopId}');
insert into public.business_employees(id, business_id, display_name, role, active)
values ('${employeeId}', '${businessId}', 'Round 16 Owner', 'OWNER', true);
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
  '${businessId}', '${shopId}', 'receipt.footer', '"Round 16 staged A"'::jsonb, 1, '${employeeId}'
);
insert into public.catalog_master_categories(id, business_id, canonical_name)
values ('${masterCategoryId}', '${businessId}', 'Round 16 Category');
insert into public.catalog_master_products(
  id, business_id, master_category_id, canonical_name
) values (
  '${masterProductId}', '${businessId}', '${masterCategoryId}', 'Round 16 Product'
);
`;

const settingsSnapshotIdempotencySql = String.raw`
begin;
${fixtureSql}

do $$
declare
  v_result jsonb;
  v_first jsonb;
  v_second jsonb;
  v_replay jsonb;
  v_first_id uuid;
  v_second_id uuid;
  v_count integer;
  v_first_payload jsonb;
  v_second_payload jsonb;
begin
  v_result := public.publish_shop_settings_v1('${employeeId}', '${shopId}', 0);
  if coalesce((v_result ->> 'ok')::boolean, false) is not true
     or (v_result ->> 'settingsVersion')::bigint <> 1 then
    raise exception 'round 16 baseline settings publish failed: %', v_result;
  end if;

  v_first := public.schedule_shop_settings_publish_v1(
    '${employeeId}', '${shopId}', 1, timestamp '2099-02-10 20:00:00'
  );
  v_first_id := (v_first ->> 'scheduleId')::uuid;
  if v_first_id is null then
    raise exception 'round 16 first settings schedule was not accepted: %', v_first;
  end if;

  -- Change staged settings without publishing. The published settings version intentionally stays 1.
  update public.shop_setting_overrides
  set value_json = '"Round 16 staged B"'::jsonb,
      version = version + 1,
      updated_by_employee_id = '${employeeId}',
      updated_at = now()
  where business_id = '${businessId}'
    and shop_id = '${shopId}'
    and setting_key = 'receipt.footer';

  v_second := public.schedule_shop_settings_publish_v1(
    '${employeeId}', '${shopId}', 1, timestamp '2099-02-10 20:00:00'
  );
  v_second_id := (v_second ->> 'scheduleId')::uuid;
  if v_second_id is null then
    raise exception 'round 16 second settings schedule was not accepted: %', v_second;
  end if;
  if v_second_id = v_first_id or coalesce((v_second ->> 'idempotentReplay')::boolean, false) then
    raise exception 'round 16 changed settings snapshot was discarded as idempotent replay: first=%, second=%',
      v_first, v_second;
  end if;

  select payload_json -> 'settingsPayload' into v_first_payload
  from public.scheduled_config_changes where id = v_first_id;
  select payload_json -> 'settingsPayload' into v_second_payload
  from public.scheduled_config_changes where id = v_second_id;
  if v_first_payload = v_second_payload then
    raise exception 'round 16 fixture did not produce distinct immutable settings snapshots';
  end if;

  select count(*) into v_count
  from public.scheduled_config_changes
  where shop_id = '${shopId}'
    and change_kind = 'SHOP_CONFIG'
    and payload_json ->> 'operation' = 'PUBLISH_SETTINGS'
    and local_scheduled_at = timestamp '2099-02-10 20:00:00';
  if v_count <> 2 then
    raise exception 'round 16 expected two distinct same-time settings intents, found %', v_count;
  end if;

  -- Repeating snapshot B exactly must still replay its own durable action.
  v_replay := public.schedule_shop_settings_publish_v1(
    '${employeeId}', '${shopId}', 1, timestamp '2099-02-10 20:00:00'
  );
  if (v_replay ->> 'scheduleId')::uuid <> v_second_id
     or coalesce((v_replay ->> 'idempotentReplay')::boolean, false) is not true then
    raise exception 'round 16 exact settings snapshot did not replay deterministically: %', v_replay;
  end if;
end $$;

rollback;
`;

const recurringDstSql = String.raw`
begin;
${fixtureSql}

do $$
declare
  v_gap_local timestamp without time zone;
  v_repeat_local timestamp without time zone;
  v_result jsonb;
  v_count integer;
  v_now timestamptz;
begin
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
    raise exception 'round 16 timezone fixture could not discover Cairo DST gap/repeat: gap=%, repeat=%',
      v_gap_local, v_repeat_local;
  end if;

  -- Policy: if either boundary of a recurrence window is not a unique Cairo wall-clock instant,
  -- skip the whole occurrence. Never materialize only ENTER or only EXIT and never silently shift.
  insert into public.recurring_availability_rules(
    id, business_id, shop_id, master_product_id, created_by_employee_id, timezone,
    days_of_week, start_local, end_local, available, active, version
  ) values (
    '${gapRuleId}', '${businessId}', '${shopId}', '${masterProductId}', '${employeeId}', 'Africa/Cairo',
    array[extract(dow from v_gap_local)::smallint],
    v_gap_local::time,
    (v_gap_local + interval '2 hours')::time,
    false, true, 1
  );

  v_now := (((v_gap_local::date - 1) + time '12:00') at time zone 'Africa/Cairo');
  v_result := public.materialize_recurring_availability_changes_v1(v_now, 2);
  if coalesce((v_result ->> 'ok')::boolean, false) is not true then
    raise exception 'round 16 gap materialization failed: %', v_result;
  end if;

  select count(*) into v_count
  from public.scheduled_config_changes
  where payload_json ->> 'ruleId' = '${gapRuleId}'
    and idempotency_key like 'recurring:${gapRuleId}:v1:' || to_char(v_gap_local::date, 'YYYY-MM-DD') || ':%';
  if v_count <> 0 then
    raise exception 'round 16 nonexistent recurring window was silently materialized: local=%, rows=%',
      v_gap_local, v_count;
  end if;

  delete from public.scheduled_config_changes where payload_json ->> 'ruleId' = '${gapRuleId}';
  delete from public.recurring_availability_rules where id = '${gapRuleId}';

  insert into public.recurring_availability_rules(
    id, business_id, shop_id, master_product_id, created_by_employee_id, timezone,
    days_of_week, start_local, end_local, available, active, version
  ) values (
    '${repeatRuleId}', '${businessId}', '${shopId}', '${masterProductId}', '${employeeId}', 'Africa/Cairo',
    array[extract(dow from v_repeat_local)::smallint],
    v_repeat_local::time,
    (v_repeat_local + interval '2 hours')::time,
    false, true, 1
  );

  v_now := (((v_repeat_local::date - 1) + time '12:00') at time zone 'Africa/Cairo');
  v_result := public.materialize_recurring_availability_changes_v1(v_now, 2);
  if coalesce((v_result ->> 'ok')::boolean, false) is not true then
    raise exception 'round 16 repeat materialization failed: %', v_result;
  end if;

  select count(*) into v_count
  from public.scheduled_config_changes
  where payload_json ->> 'ruleId' = '${repeatRuleId}'
    and idempotency_key like 'recurring:${repeatRuleId}:v1:' || to_char(v_repeat_local::date, 'YYYY-MM-DD') || ':%';
  if v_count <> 0 then
    raise exception 'round 16 ambiguous recurring window was silently materialized: local=%, rows=%',
      v_repeat_local, v_count;
  end if;
end $$;

rollback;
`;

const failures = [];
for (const [label, sql] of [
  ['SHOP_CONFIG settings snapshot idempotency', settingsSnapshotIdempotencySql],
  ['Recurring Cairo DST occurrence policy', recurringDstSql],
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

console.log('Plan 2 round 16 PostgreSQL behavior passed.');
