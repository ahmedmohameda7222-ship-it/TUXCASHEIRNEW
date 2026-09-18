import { spawnSync } from 'node:child_process';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required');

const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Admin Plan 3 round-2 hardening test refuses non-loopback PostgreSQL.');
}

function runCheck(label, sql) {
  const result = spawnSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-X', '-q'], {
    input: sql,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    process.stderr.write(`\n[${label}]\n${result.stdout ?? ''}${result.stderr ?? ''}`);
    return false;
  }
  return true;
}

const secretReasonCheck = String.raw`
begin;
insert into public.business_employees(id, business_id, display_name, role, active)
values (
  '44000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'Plan 3 Round 2 Auditor',
  'OWNER',
  true
);

do $$
declare
  v_blocked boolean := false;
  v_message text;
begin
  begin
    perform public.append_admin_audit_event_v1(
      '00000000-0000-4000-8000-000000000001',
      null,
      '44000000-0000-4000-8000-000000000001',
      'PLAN3_SECRET_REASON_TEST',
      'TEST',
      'secret-reason-1',
      null,
      '{"ok":true}'::jsonb,
      'new PIN 482731',
      null,
      null,
      '{}'::jsonb
    );
  exception when others then
    get stacked diagnostics v_message = MESSAGE_TEXT;
    v_blocked := v_message = 'admin_audit_secret_reason_forbidden';
  end;

  if not v_blocked then
    raise exception 'secret-bearing free-text audit reason was not rejected';
  end if;
end $$;
rollback;
`;

const approvalReasonCheck = String.raw`
begin;
insert into public.business_employees(id, business_id, display_name, role, active)
values
  (
    '44000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000001',
    'Plan 3 Round 2 Requester',
    'OWNER',
    true
  ),
  (
    '44000000-0000-4000-8000-000000000012',
    '00000000-0000-4000-8000-000000000001',
    'Plan 3 Round 2 Approver',
    'OWNER',
    true
  );

insert into public.admin_approval_rules(
  id, business_id, action_type, requester_permission, approver_permission,
  requires_second_person, expires_after_seconds
) values (
  '44000000-0000-4000-8000-000000000013',
  '00000000-0000-4000-8000-000000000001',
  'PLAN3_ROUND2_REASON_TEST',
  'settings.manage',
  'approvals.review',
  true,
  3600
);

do $$
declare
  v_secret_request jsonb;
  v_safe_request jsonb;
  v_decision jsonb;
  v_request_id uuid;
begin
  select public.create_admin_approval_request_v1(
    '00000000-0000-4000-8000-000000000001',
    null,
    '44000000-0000-4000-8000-000000000011',
    null,
    '44000000-0000-4000-8000-000000000013',
    'PLAN3_ROUND2_REASON_TEST',
    '44000000-0000-4000-8000-000000000014',
    '{"safeValue":1}'::jsonb,
    'new PIN 482731'
  ) into v_secret_request;

  if v_secret_request ->> 'code' <> 'secret_reason_forbidden' then
    raise exception 'secret-bearing approval request reason was not rejected: %', v_secret_request;
  end if;

  select public.create_admin_approval_request_v1(
    '00000000-0000-4000-8000-000000000001',
    null,
    '44000000-0000-4000-8000-000000000011',
    null,
    '44000000-0000-4000-8000-000000000013',
    'PLAN3_ROUND2_REASON_TEST',
    '44000000-0000-4000-8000-000000000015',
    '{"safeValue":2}'::jsonb,
    'routine review'
  ) into v_safe_request;

  if coalesce((v_safe_request ->> 'ok')::boolean, false) is not true then
    raise exception 'safe approval request failed: %', v_safe_request;
  end if;
  v_request_id := (v_safe_request ->> 'requestId')::uuid;

  select public.decide_admin_approval_request_v1(
    v_request_id,
    '44000000-0000-4000-8000-000000000012',
    null,
    'APPROVE',
    'password hunter2'
  ) into v_decision;

  if v_decision ->> 'code' <> 'secret_reason_forbidden' then
    raise exception 'secret-bearing decision reason was not rejected: %', v_decision;
  end if;
end $$;
rollback;
`;

const approvalShopLinkCheck = String.raw`
begin;
insert into public.business_employees(id, business_id, display_name, role, active)
values (
  '44000000-0000-4000-8000-000000000021',
  '00000000-0000-4000-8000-000000000001',
  'Plan 3 Round 2 Shop Auditor',
  'OWNER',
  true
);

insert into public.admin_approval_rules(
  id, business_id, action_type, requester_permission, approver_permission,
  requires_second_person, expires_after_seconds
) values (
  '44000000-0000-4000-8000-000000000022',
  '00000000-0000-4000-8000-000000000001',
  'PLAN3_ROUND2_SHOP_LINK_TEST',
  'settings.manage',
  'approvals.review',
  true,
  3600
);

do $$
declare
  v_request_id uuid;
  v_shop_id uuid;
  v_blocked boolean := false;
  v_message text;
begin
  select bs.shop_id into v_shop_id
  from public.business_shops bs
  where bs.business_id = '00000000-0000-4000-8000-000000000001'
  order by bs.shop_id
  limit 1;

  if v_shop_id is null then
    raise exception 'round-2 shop-link fixture requires one business shop';
  end if;

  insert into public.admin_approval_requests(
    business_id,
    shop_id,
    approval_rule_id,
    requester_employee_id,
    action_type,
    command_id,
    command_payload,
    required_approver_permission,
    requires_second_person,
    status,
    expires_at
  ) values (
    '00000000-0000-4000-8000-000000000001',
    null,
    '44000000-0000-4000-8000-000000000022',
    '44000000-0000-4000-8000-000000000021',
    'PLAN3_ROUND2_SHOP_LINK_TEST',
    '44000000-0000-4000-8000-000000000023',
    '{"safeValue":1}'::jsonb,
    'approvals.review',
    true,
    'PENDING',
    now() + interval '1 hour'
  ) returning id into v_request_id;

  begin
    perform public.append_admin_audit_event_v1(
      '00000000-0000-4000-8000-000000000001',
      v_shop_id,
      '44000000-0000-4000-8000-000000000021',
      'PLAN3_ROUND2_SHOP_LINK_EVENT',
      'APPROVAL_REQUEST',
      v_request_id::text,
      null,
      '{"status":"PENDING"}'::jsonb,
      'shop-link check',
      v_request_id,
      null,
      '{}'::jsonb
    );
  exception when others then
    get stacked diagnostics v_message = MESSAGE_TEXT;
    v_blocked := v_message = 'admin_audit_approval_shop_mismatch';
  end;

  if not v_blocked then
    raise exception 'audit event accepted a shop different from its linked approval';
  end if;
end $$;
rollback;
`;

const joinedAuditStatusCheck = String.raw`
begin;
insert into public.business_employees(id, business_id, display_name, role, active)
values
  (
    '44000000-0000-4000-8000-000000000031',
    '00000000-0000-4000-8000-000000000001',
    'Plan 3 Round 2 Scale Requester',
    'OWNER',
    true
  ),
  (
    '44000000-0000-4000-8000-000000000032',
    '00000000-0000-4000-8000-000000000001',
    'Plan 3 Round 2 Scale Approver',
    'OWNER',
    true
  );

insert into public.admin_approval_rules(
  id, business_id, action_type, requester_permission, approver_permission,
  requires_second_person, expires_after_seconds
) values (
  '44000000-0000-4000-8000-000000000033',
  '00000000-0000-4000-8000-000000000001',
  'PLAN3_ROUND2_SCALE_TEST',
  'settings.manage',
  'approvals.review',
  true,
  3600
);

with inserted as (
  insert into public.admin_approval_requests(
    business_id,
    approval_rule_id,
    requester_employee_id,
    action_type,
    command_id,
    command_payload,
    required_approver_permission,
    requires_second_person,
    status,
    approver_employee_id,
    decided_at,
    expires_at,
    created_at,
    updated_at
  )
  select
    '00000000-0000-4000-8000-000000000001'::uuid,
    '44000000-0000-4000-8000-000000000033'::uuid,
    '44000000-0000-4000-8000-000000000031'::uuid,
    'PLAN3_ROUND2_SCALE_TEST',
    gen_random_uuid(),
    jsonb_build_object('ordinal', n),
    'approvals.review',
    true,
    'APPROVED',
    '44000000-0000-4000-8000-000000000032'::uuid,
    now(),
    now() + interval '1 hour',
    now() + (n || ' milliseconds')::interval,
    now() + (n || ' milliseconds')::interval
  from generate_series(1, 501) as series(n)
  returning id, created_at
)
insert into public.admin_audit_events(
  business_id,
  actor_employee_id,
  action_type,
  entity_type,
  entity_id,
  after_value,
  approval_request_id,
  created_at
)
select
  '00000000-0000-4000-8000-000000000001'::uuid,
  '44000000-0000-4000-8000-000000000032'::uuid,
  'PLAN3_ROUND2_SCALE_EVENT',
  'APPROVAL_REQUEST',
  id::text,
  '{"status":"APPROVED"}'::jsonb,
  id,
  created_at
from inserted;

do $$
declare
  v_count integer;
  v_proc oid;
begin
  select count(*) into v_count
  from public.list_admin_audit_events_v1(
    p_business_id => '00000000-0000-4000-8000-000000000001'::uuid,
    p_shop_ids => null::uuid[],
    p_shop_id => null::uuid,
    p_actor_employee_id => null::uuid,
    p_action_type => null::text,
    p_entity_type => null::text,
    p_entity_id => null::text,
    p_from => null::timestamptz,
    p_to => null::timestamptz,
    p_approval_status => 'APPROVED'::text,
    p_event_id => null::uuid,
    p_limit => 100
  );

  if v_count <> 100 then
    raise exception 'joined approval-status audit query returned %, expected 100', v_count;
  end if;

  select p.oid into v_proc
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'list_admin_audit_events_v1';

  if v_proc is null then
    raise exception 'list_admin_audit_events_v1 missing';
  end if;
  if has_function_privilege('anon', v_proc, 'EXECUTE')
     or has_function_privilege('authenticated', v_proc, 'EXECUTE') then
    raise exception 'browser role can execute list_admin_audit_events_v1';
  end if;
  if to_regrole('service_role') is not null
     and not has_function_privilege('service_role', v_proc, 'EXECUTE') then
    raise exception 'service_role cannot execute list_admin_audit_events_v1';
  end if;
end $$;
rollback;
`;

const results = [
  ['free-text audit secret rejection', secretReasonCheck],
  ['approval reason secret rejection', approvalReasonCheck],
  ['approval-linked audit shop integrity', approvalShopLinkCheck],
  ['joined approval-status audit scale', joinedAuditStatusCheck],
].map(([label, sql]) => runCheck(label, sql));

if (results.some((passed) => !passed)) process.exit(1);
console.log('Admin Plan 3 review round-2 PostgreSQL hardening passed.');
