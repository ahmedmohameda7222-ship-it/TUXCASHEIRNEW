import { spawnSync } from 'node:child_process';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required');

const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Admin Plan 3 round-6 hardening test refuses non-loopback PostgreSQL.');
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

const credentialNarrativeCheck = String.raw`
begin;
do $$
begin
  if private.admin_text_contains_secret_v1('PIN was 4827') is not true then
    raise exception 'PIN narrative using was was not detected';
  end if;
  if private.admin_text_contains_secret_v1('password was hunter2') is not true then
    raise exception 'password narrative using was was not detected';
  end if;
  if private.admin_text_contains_secret_v1('Salt inventory count adjusted') is not false then
    raise exception 'ordinary food salt reason was incorrectly classified as secret';
  end if;
end $$;
rollback;
`;

const explicitFinalRetryCheck = String.raw`
begin;
insert into public.business_employees(id, business_id, display_name, role, active)
values
  (
    '41000000-0000-4000-8000-000000000031',
    '00000000-0000-4000-8000-000000000001',
    'Plan 3 Round 6 Requester',
    'OWNER',
    true
  ),
  (
    '41000000-0000-4000-8000-000000000032',
    '00000000-0000-4000-8000-000000000001',
    'Plan 3 Round 6 Approver',
    'OWNER',
    true
  );

insert into public.admin_approval_rules(
  id, business_id, action_type, requester_permission, approver_permission,
  requires_second_person, expires_after_seconds
) values (
  '43000000-0000-4000-8000-000000000031',
  '00000000-0000-4000-8000-000000000001',
  'PLAN3_ROUND6_FINAL_RETRY_TEST',
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
  v_completion jsonb;
  v_reclaimed record;
  v_now timestamptz := '2026-09-17T19:00:00Z'::timestamptz;
begin
  select public.create_admin_approval_request_v1(
    '00000000-0000-4000-8000-000000000001',
    null,
    '41000000-0000-4000-8000-000000000031',
    null,
    '43000000-0000-4000-8000-000000000031',
    'PLAN3_ROUND6_FINAL_RETRY_TEST',
    '42000000-0000-4000-8000-000000000031',
    '{"safeValue":106}'::jsonb,
    'round six reconciliation proof'
  ) into v_request;
  if coalesce((v_request ->> 'ok')::boolean, false) is not true then
    raise exception 'round-6 request creation failed: %', v_request;
  end if;
  v_request_id := (v_request ->> 'requestId')::uuid;

  select public.decide_admin_approval_request_v1(
    v_request_id,
    '41000000-0000-4000-8000-000000000032',
    null,
    'APPROVE',
    'round six approved'
  ) into v_decision;
  if coalesce((v_decision ->> 'ok')::boolean, false) is not true then
    raise exception 'round-6 request approval failed: %', v_decision;
  end if;

  update public.admin_approval_requests
  set status = 'EXECUTING', updated_at = v_now
  where id = v_request_id;

  update public.admin_approval_execution_jobs
  set state = 'CLAIMED',
      claim_token_hash = encode(extensions.digest('round6-final-token', 'sha256'), 'hex'),
      completed_claim_token_hash = null,
      claimed_by = 'round6-worker',
      lease_expires_at = v_now + interval '5 minutes',
      attempt_count = 5,
      next_attempt_at = null,
      last_error_code = null,
      updated_at = v_now,
      completed_at = null
  where approval_request_id = v_request_id;

  select public.complete_admin_approval_execution_v1(
    v_request_id,
    'round6-final-token',
    'RETRYABLE',
    'business_effect_outcome_ambiguous',
    null,
    v_now + interval '1 second'
  ) into v_completion;

  if coalesce((v_completion ->> 'ok')::boolean, false) is not true
     or v_completion ->> 'status' <> 'RETRYABLE' then
    raise exception 'attempt-5 retryable completion became terminal: %', v_completion;
  end if;

  if not exists (
    select 1
    from public.admin_approval_execution_jobs
    where approval_request_id = v_request_id
      and state = 'RETRYABLE'
      and attempt_count = 5
      and next_attempt_at is not null
      and completed_at is null
  ) then
    raise exception 'attempt-5 retryable job was not preserved for reconciliation';
  end if;

  if not exists (
    select 1
    from public.admin_approval_requests
    where id = v_request_id and status = 'APPROVED' and failed_at is null
  ) then
    raise exception 'attempt-5 retryable request did not return to APPROVED';
  end if;

  if exists (
    select 1
    from public.admin_audit_events
    where approval_request_id = v_request_id
      and action_type = 'APPROVAL_COMMAND_FAILED'
  ) then
    raise exception 'ambiguous retryable completion emitted a terminal failure audit event';
  end if;

  select * into v_reclaimed
  from public.claim_admin_approval_execution_v1(
    'round6-reconciler',
    v_now + interval '16 minutes',
    1,
    30
  );

  if v_reclaimed.approval_request_id is distinct from v_request_id
     or v_reclaimed.attempt_count <> 5
     or nullif(v_reclaimed.claim_token, '') is null then
    raise exception 'attempt-5 RETRYABLE job was not reclaimed without incrementing attempts';
  end if;

  select public.complete_admin_approval_execution_v1(
    v_request_id,
    v_reclaimed.claim_token,
    'EXECUTED',
    null,
    '{"reconciled":true}'::jsonb,
    v_now + interval '16 minutes 1 second'
  ) into v_completion;

  if coalesce((v_completion ->> 'ok')::boolean, false) is not true
     or v_completion ->> 'status' <> 'EXECUTED' then
    raise exception 'attempt-5 reconciliation did not converge to EXECUTED: %', v_completion;
  end if;
end $$;
rollback;
`;

const results = [
  ['credential narrative detection', credentialNarrativeCheck],
  ['explicit fifth-attempt retry reconciliation', explicitFinalRetryCheck],
].map(([label, sql]) => runCheck(label, sql));

if (results.some((passed) => !passed)) process.exit(1);
console.log('Admin Plan 3 review round-6 PostgreSQL behavior passed.');