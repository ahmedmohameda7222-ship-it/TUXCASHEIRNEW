import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const migrationPath =
  'supabase/migrations/20260910122900_admin_plan2_final_review_round14_hardening.sql';
if (!fs.existsSync(migrationPath)) {
  throw new Error(`Plan 2 round 14 hardening migration is missing: ${migrationPath}`);
}

const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();
for (const fragment of [
  'settings_publication_kind',
  "'emergency_operational_state'",
  "'scheduled_settings_publish'",
  "'scheduled_online_orders_state'",
  'schedule_admin_shop_config_v1',
  'apply_scheduled_shop_config_change_v1',
  "'emergency_operational_state', 'scheduled_settings_publish', 'scheduled_online_orders_state'",
]) {
  if (!sql.includes(fragment)) {
    throw new Error(`Plan 2 round 14 hardening missing ${fragment}`);
  }
}
if (sql.includes("last_error = 'replaced_by_reschedule'")) {
  throw new Error('Plan 2 round 14 must not globally replace independent SHOP_CONFIG schedules.');
}

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('Plan 2 round 14 hardening static invariant passed.');
  process.exit(0);
}

const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Plan 2 round 14 behavioral test refuses non-loopback PostgreSQL.');
}

const businessId = '00000000-0000-4000-8000-000000000140';
const shopId = '14000000-0000-4000-8000-000000000140';
const employeeId = '24000000-0000-4000-8000-000000000140';
const orderTypeId = '34000000-0000-4000-8000-000000000140';
const paymentMethodId = '44000000-0000-4000-8000-000000000140';

const behaviorSql = String.raw`
begin;

insert into public.businesses(id, name, timezone, currency_code)
values ('${businessId}', 'Plan 2 Round 14 Fixture', 'Africa/Cairo', 'EGP');
insert into public.shops(id, name, active)
values ('${shopId}', 'Round 14 Shop', true);
insert into public.business_shops(business_id, shop_id)
values ('${businessId}', '${shopId}');
insert into public.business_employees(id, business_id, display_name, role, active)
values ('${employeeId}', '${businessId}', 'Round 14 Owner', 'OWNER', true);
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
  '${businessId}', '${shopId}', 'receipt.footer', '"Round 14 baseline"'::jsonb, 1, '${employeeId}'
);

do $$
declare
  v_result jsonb;
  v_schedule jsonb;
  v_schedule_id uuid;
  v_idempotency_key text;
  v_attempt integer;
  v_pause_id uuid;
  v_resume_id uuid;
  v_full_id uuid;
  v_followup_id uuid;
  v_kind text;
  v_footer text;
begin
  v_result := public.publish_shop_settings_v1('${employeeId}', '${shopId}', 0);
  if coalesce((v_result ->> 'ok')::boolean, false) is not true
     or (v_result ->> 'settingsVersion')::bigint <> 1 then
    raise exception 'round 14 baseline settings publish failed: %', v_result;
  end if;

  update public.shop_setting_overrides
  set value_json = '"Scheduled after emergency"'::jsonb,
      version = version + 1,
      updated_at = now()
  where business_id = '${businessId}' and shop_id = '${shopId}' and setting_key = 'receipt.footer';

  -- P1 regression: an accepted full settings schedule survives a later emergency-only publication.
  v_schedule := public.schedule_shop_settings_publish_v1(
    '${employeeId}', '${shopId}', 1, timestamp '2099-01-01 22:00:00'
  );
  if coalesce((v_schedule ->> 'ok')::boolean, false) is not true then
    raise exception 'round 14 settings schedule creation failed: %', v_schedule;
  end if;
  v_schedule_id := (v_schedule ->> 'scheduleId')::uuid;

  v_result := public.update_admin_shop_operational_state_v1(
    '${employeeId}', '${shopId}', true, false, 1
  );
  if coalesce((v_result ->> 'ok')::boolean, false) is not true
     or (v_result ->> 'settingsVersion')::bigint <> 2 then
    raise exception 'round 14 emergency publication failed: %', v_result;
  end if;
  select settings_publication_kind into v_kind
  from public.shop_settings_versions
  where shop_id = '${shopId}' and settings_version = 2;
  if v_kind <> 'EMERGENCY_OPERATIONAL_STATE' then
    raise exception 'round 14 emergency publication lineage missing: %', v_kind;
  end if;

  perform public.claim_due_admin_config_changes_v1(
    timestamptz '2099-01-01 21:00:00+00', 25, 300
  );
  select idempotency_key, attempt_count into v_idempotency_key, v_attempt
  from public.scheduled_config_changes
  where id = v_schedule_id and status = 'CLAIMED';
  if v_attempt is null then
    raise exception 'round 14 emergency-rebase schedule was not claimed';
  end if;

  v_result := public.apply_scheduled_shop_config_change_v1(
    v_schedule_id, v_idempotency_key, v_attempt
  );
  if coalesce((v_result ->> 'ok')::boolean, false) is not true
     or (v_result ->> 'settingsVersion')::bigint <> 3 then
    raise exception 'round 14 accepted schedule did not rebase over emergency publication: %', v_result;
  end if;
  select settings_publication_kind,
         settings_json #>> '{settings,values,receipt.footer}'
    into v_kind, v_footer
  from public.shop_settings_versions
  where shop_id = '${shopId}' and settings_version = 3;
  if v_kind <> 'SCHEDULED_SETTINGS_PUBLISH' or v_footer <> 'Scheduled after emergency' then
    raise exception 'round 14 scheduled settings snapshot/lineage was not preserved: %, %', v_kind, v_footer;
  end if;
  if not exists (
    select 1 from public.shops s
    where s.id = '${shopId}' and s.temporary_closed = true
  ) then
    raise exception 'round 14 scheduled settings publication erased emergency closure state';
  end if;
  update public.scheduled_config_changes
  set status = 'APPLIED', applied_at = now(), claimed_at = null, updated_at = now()
  where id = v_schedule_id;

  -- Ordinary settings publication is still a hard stale barrier.
  update public.shop_setting_overrides
  set value_json = '"Manual barrier"'::jsonb,
      version = version + 1,
      updated_at = now()
  where business_id = '${businessId}' and shop_id = '${shopId}' and setting_key = 'receipt.footer';
  v_schedule := public.schedule_shop_settings_publish_v1(
    '${employeeId}', '${shopId}', 3, timestamp '2099-01-02 22:00:00'
  );
  if coalesce((v_schedule ->> 'ok')::boolean, false) is not true then
    raise exception 'round 14 stale-barrier schedule creation failed: %', v_schedule;
  end if;
  v_schedule_id := (v_schedule ->> 'scheduleId')::uuid;
  v_result := public.publish_shop_settings_v1('${employeeId}', '${shopId}', 3);
  if coalesce((v_result ->> 'ok')::boolean, false) is not true
     or (v_result ->> 'settingsVersion')::bigint <> 4 then
    raise exception 'round 14 ordinary settings publication fixture failed: %', v_result;
  end if;
  perform public.claim_due_admin_config_changes_v1(
    timestamptz '2099-01-02 21:00:00+00', 25, 300
  );
  select idempotency_key, attempt_count into v_idempotency_key, v_attempt
  from public.scheduled_config_changes
  where id = v_schedule_id and status = 'CLAIMED';
  v_result := public.apply_scheduled_shop_config_change_v1(
    v_schedule_id, v_idempotency_key, v_attempt
  );
  if v_result ->> 'code' <> 'stale_settings_version'
     or (v_result ->> 'currentVersion')::bigint <> 4 then
    raise exception 'round 14 ordinary settings publish did not remain a stale barrier: %', v_result;
  end if;
  update public.scheduled_config_changes
  set status = 'CANCELLED', claimed_at = null, updated_at = now()
  where id = v_schedule_id;

  -- P2 regression: pause and resume accepted against the same base remain independent jobs.
  v_schedule := public.schedule_shop_online_orders_state_v1(
    '${employeeId}', '${shopId}', true, 4, timestamp '2099-01-03 22:00:00'
  );
  v_pause_id := (v_schedule ->> 'scheduleId')::uuid;
  v_schedule := public.schedule_shop_online_orders_state_v1(
    '${employeeId}', '${shopId}', false, 4, timestamp '2099-01-03 23:00:00'
  );
  v_resume_id := (v_schedule ->> 'scheduleId')::uuid;
  if v_pause_id is null or v_resume_id is null or v_pause_id = v_resume_id then
    raise exception 'round 14 independent pause/resume schedules were not created';
  end if;
  if (
    select count(*) from public.scheduled_config_changes s
    where s.id in (v_pause_id, v_resume_id) and s.status = 'PENDING'
  ) <> 2 then
    raise exception 'round 14 second SHOP_CONFIG schedule cancelled the first';
  end if;

  perform public.claim_due_admin_config_changes_v1(
    timestamptz '2099-01-03 20:30:00+00', 25, 300
  );
  select idempotency_key, attempt_count into v_idempotency_key, v_attempt
  from public.scheduled_config_changes where id = v_pause_id and status = 'CLAIMED';
  v_result := public.apply_scheduled_shop_config_change_v1(v_pause_id, v_idempotency_key, v_attempt);
  if coalesce((v_result ->> 'ok')::boolean, false) is not true
     or (v_result ->> 'settingsVersion')::bigint <> 5 then
    raise exception 'round 14 pause schedule failed: %', v_result;
  end if;
  update public.scheduled_config_changes
  set status = 'APPLIED', applied_at = now(), claimed_at = null, updated_at = now()
  where id = v_pause_id;

  perform public.claim_due_admin_config_changes_v1(
    timestamptz '2099-01-03 21:30:00+00', 25, 300
  );
  select idempotency_key, attempt_count into v_idempotency_key, v_attempt
  from public.scheduled_config_changes where id = v_resume_id and status = 'CLAIMED';
  v_result := public.apply_scheduled_shop_config_change_v1(v_resume_id, v_idempotency_key, v_attempt);
  if coalesce((v_result ->> 'ok')::boolean, false) is not true
     or (v_result ->> 'settingsVersion')::bigint <> 6 then
    raise exception 'round 14 resume schedule did not chain over pause: %', v_result;
  end if;
  if not exists (
    select 1 from public.shops s where s.id = '${shopId}' and s.online_orders_paused = false
  ) then
    raise exception 'round 14 final online-order state is not resumed';
  end if;
  update public.scheduled_config_changes
  set status = 'APPLIED', applied_at = now(), claimed_at = null, updated_at = now()
  where id = v_resume_id;

  -- Stronger sequencing: a later online patch may also chain over an earlier scheduled full publish.
  update public.shop_setting_overrides
  set value_json = '"Scheduled full predecessor"'::jsonb,
      version = version + 1,
      updated_at = now()
  where business_id = '${businessId}' and shop_id = '${shopId}' and setting_key = 'receipt.footer';
  v_schedule := public.schedule_shop_settings_publish_v1(
    '${employeeId}', '${shopId}', 6, timestamp '2099-01-04 22:00:00'
  );
  v_full_id := (v_schedule ->> 'scheduleId')::uuid;
  v_schedule := public.schedule_shop_online_orders_state_v1(
    '${employeeId}', '${shopId}', true, 6, timestamp '2099-01-04 23:00:00'
  );
  v_followup_id := (v_schedule ->> 'scheduleId')::uuid;
  if v_full_id is null or v_followup_id is null then
    raise exception 'round 14 scheduled full/follow-up pair was not accepted';
  end if;

  perform public.claim_due_admin_config_changes_v1(
    timestamptz '2099-01-04 20:30:00+00', 25, 300
  );
  select idempotency_key, attempt_count into v_idempotency_key, v_attempt
  from public.scheduled_config_changes where id = v_full_id and status = 'CLAIMED';
  v_result := public.apply_scheduled_shop_config_change_v1(v_full_id, v_idempotency_key, v_attempt);
  if coalesce((v_result ->> 'ok')::boolean, false) is not true
     or (v_result ->> 'settingsVersion')::bigint <> 7 then
    raise exception 'round 14 scheduled full predecessor failed: %', v_result;
  end if;
  update public.scheduled_config_changes
  set status = 'APPLIED', applied_at = now(), claimed_at = null, updated_at = now()
  where id = v_full_id;

  perform public.claim_due_admin_config_changes_v1(
    timestamptz '2099-01-04 21:30:00+00', 25, 300
  );
  select idempotency_key, attempt_count into v_idempotency_key, v_attempt
  from public.scheduled_config_changes where id = v_followup_id and status = 'CLAIMED';
  v_result := public.apply_scheduled_shop_config_change_v1(v_followup_id, v_idempotency_key, v_attempt);
  if coalesce((v_result ->> 'ok')::boolean, false) is not true
     or (v_result ->> 'settingsVersion')::bigint <> 8 then
    raise exception 'round 14 later patch did not chain over scheduled full publication: %', v_result;
  end if;
  if not exists (
    select 1 from public.shops s where s.id = '${shopId}' and s.online_orders_paused = true
  ) then
    raise exception 'round 14 full-to-patch sequencing lost final online state';
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

console.log('Plan 2 round 14 hardening PostgreSQL behavior passed.');
