import { spawnSync } from 'node:child_process';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required');

const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Admin Plan 3 review hardening test refuses non-loopback PostgreSQL.');
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

const camelCaseSecretCheck = String.raw`
begin;
do $$
begin
  if private.admin_json_contains_secret_key_v1(
    '{"employeeId":"employee-2","newPin":"482731"}'::jsonb
  ) is not true then
    raise exception 'camelCase newPin was not detected as credential material';
  end if;
end $$;
rollback;
`;

const finalLeaseCheck = String.raw`
begin;
insert into public.business_employees(id, business_id, display_name, role, active)
values
  (
    '41000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000001',
    'Plan 3 Review Requester',
    'OWNER',
    true
  ),
  (
    '41000000-0000-4000-8000-000000000012',
    '00000000-0000-4000-8000-000000000001',
    'Plan 3 Review Approver',
    'OWNER',
    true
  );

insert into public.admin_approval_rules(
  id, business_id, action_type, requester_permission, approver_permission,
  requires_second_person, expires_after_seconds
) values (
  '43000000-0000-4000-8000-000000000011',
  '00000000-0000-4000-8000-000000000001',
  'PLAN3_REVIEW_FINAL_LEASE_TEST',
  'settings.manage',
  'approvals.review',
  true,
  3600
);

do $$
declare
  v_request jsonb;
  v_decision jsonb;
  v_request_id uuid;
  v_reclaimed record;
  v_completion jsonb;
  v_now timestamptz := '2026-09-16T20:00:00Z'::timestamptz;
begin
  select public.create_admin_approval_request_v1(
    '00000000-0000-4000-8000-000000000001',
    null,
    '41000000-0000-4000-8000-000000000011',
    null,
    '43000000-0000-4000-8000-000000000011',
    'PLAN3_REVIEW_FINAL_LEASE_TEST',
    '42000000-0000-4000-8000-000000000011',
    '{"safeValue":99}'::jsonb,
    'final lease ambiguity proof'
  ) into v_request;
  if coalesce((v_request ->> 'ok')::boolean, false) is not true then
    raise exception 'review request creation failed: %', v_request;
  end if;
  v_request_id := (v_request ->> 'requestId')::uuid;

  select public.decide_admin_approval_request_v1(
    v_request_id,
    '41000000-0000-4000-8000-000000000012',
    null,
    'APPROVE',
    'review approved'
  ) into v_decision;
  if coalesce((v_decision ->> 'ok')::boolean, false) is not true then
    raise exception 'review request approval failed: %', v_decision;
  end if;

  update public.admin_approval_requests
  set status = 'EXECUTING', updated_at = v_now - interval '2 minutes'
  where id = v_request_id;

  update public.admin_approval_execution_jobs
  set state = 'CLAIMED',
      claim_token_hash = encode(extensions.digest('expired-final-token', 'sha256'), 'hex'),
      completed_claim_token_hash = null,
      claimed_by = 'worker-before-crash',
      lease_expires_at = v_now - interval '1 minute',
      attempt_count = 5,
      next_attempt_at = null,
      last_error_code = null,
      updated_at = v_now - interval '2 minutes',
      completed_at = null
  where approval_request_id = v_request_id;

  select * into v_reclaimed
  from public.claim_admin_approval_execution_v1('reconciler', v_now, 1, 30);

  if v_reclaimed.approval_request_id is distinct from v_request_id
     or v_reclaimed.attempt_count <> 5
     or nullif(v_reclaimed.claim_token, '') is null then
    raise exception 'expired fifth lease was not reclaimed for reconciliation';
  end if;

  if exists (
    select 1 from public.admin_approval_requests
    where id = v_request_id and status = 'FAILED'
  ) then
    raise exception 'expired fifth lease was incorrectly marked FAILED';
  end if;

  select public.complete_admin_approval_execution_v1(
    v_request_id,
    v_reclaimed.claim_token,
    'EXECUTED',
    null,
    '{"reconciled":true}'::jsonb,
    v_now + interval '1 second'
  ) into v_completion;

  if coalesce((v_completion ->> 'ok')::boolean, false) is not true
     or v_completion ->> 'status' <> 'EXECUTED' then
    raise exception 'reconciled final claim could not converge to EXECUTED: %', v_completion;
  end if;
end $$;
rollback;
`;

const results = [
  ['camelCase secret rejection', camelCaseSecretCheck],
  ['final lease reconciliation', finalLeaseCheck],
].map(([label, sql]) => runCheck(label, sql));

if (results.some((passed) => !passed)) process.exit(1);
console.log('Admin Plan 3 review hardening PostgreSQL behavior passed.');
