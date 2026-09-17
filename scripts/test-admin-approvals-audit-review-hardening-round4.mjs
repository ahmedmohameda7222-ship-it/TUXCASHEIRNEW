import { spawnSync } from 'node:child_process';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required');

const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Admin Plan 3 round-4 hardening test refuses non-loopback PostgreSQL.');
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

const naturalLanguagePinReasonCheck = String.raw`
begin;
do $$
begin
  if private.admin_text_contains_secret_v1('new PIN is 4827') is not true then
    raise exception 'natural-language 4-digit PIN reason was not detected';
  end if;
  if private.admin_text_contains_secret_v1('set passcode to 123456789012') is not true then
    raise exception 'natural-language 12-digit passcode reason was not detected';
  end if;
end $$;
rollback;
`;

const optionalSecondPersonCheck = String.raw`
begin;
insert into public.business_employees(id, business_id, display_name, role, active)
values (
  '41000000-0000-4000-8000-000000000041',
  '00000000-0000-4000-8000-000000000001',
  'Plan 3 Round 4 Owner',
  'OWNER',
  true
);

insert into public.admin_approval_rules(
  id, business_id, action_type, requester_permission, approver_permission,
  requires_second_person, expires_after_seconds
) values (
  '43000000-0000-4000-8000-000000000041',
  '00000000-0000-4000-8000-000000000001',
  'PLAN3_ROUND4_OPTIONAL_SECOND_PERSON',
  'settings.manage',
  'approvals.review',
  false,
  3600
);

do $$
declare
  v_request jsonb;
  v_decision jsonb;
  v_request_id uuid;
begin
  select public.create_admin_approval_request_v1(
    '00000000-0000-4000-8000-000000000001',
    null,
    '41000000-0000-4000-8000-000000000041',
    null,
    '43000000-0000-4000-8000-000000000041',
    'PLAN3_ROUND4_OPTIONAL_SECOND_PERSON',
    '42000000-0000-4000-8000-000000000041',
    '{"safeValue":41}'::jsonb,
    'single-person approval allowed by rule'
  ) into v_request;

  if coalesce((v_request ->> 'ok')::boolean, false) is not true then
    raise exception 'optional-second-person request creation failed: %', v_request;
  end if;
  v_request_id := (v_request ->> 'requestId')::uuid;

  select public.decide_admin_approval_request_v1(
    v_request_id,
    '41000000-0000-4000-8000-000000000041',
    null,
    'APPROVE',
    'requester may decide because rule disables second person'
  ) into v_decision;

  if coalesce((v_decision ->> 'ok')::boolean, false) is not true
     or v_decision ->> 'status' <> 'APPROVED' then
    raise exception 'non-second-person rule did not permit requester decision: %', v_decision;
  end if;

  if not exists (
    select 1
    from public.admin_approval_requests
    where id = v_request_id
      and requester_employee_id = approver_employee_id
      and requires_second_person = false
      and status = 'APPROVED'
  ) then
    raise exception 'approved non-second-person request was not persisted with requester as approver';
  end if;
end $$;
rollback;
`;

const results = [
  ['natural-language PIN reason detection', naturalLanguagePinReasonCheck],
  ['optional second-person rule', optionalSecondPersonCheck],
].map(([label, sql]) => runCheck(label, sql));

if (results.some((passed) => !passed)) process.exit(1);
