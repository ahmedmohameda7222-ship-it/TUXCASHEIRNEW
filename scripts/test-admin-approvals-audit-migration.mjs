import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const migrationPath = 'supabase/migrations/20260910125000_admin_approvals_audit.sql';
const databaseUrl = process.env.TEST_DATABASE_URL;
const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();

for (const name of [
  'admin_audit_events',
  'admin_approval_rules',
  'admin_approval_requests',
  'admin_approval_execution_jobs',
  'create_admin_approval_request_v1',
  'decide_admin_approval_request_v1',
  'claim_admin_approval_execution_v1',
  'complete_admin_approval_execution_v1',
  'append_admin_audit_event_v1',
]) {
  if (!sql.includes(name)) throw new Error(`missing ${name}`);
}

for (const token of [
  'command_id',
  'lease_expires_at',
  'attempt_count',
  'next_attempt_at',
  'claim_token_hash',
  'self_approval_forbidden',
  'for update skip locked',
  'secret_payload_forbidden',
]) {
  if (!sql.includes(token)) throw new Error(`durable approval/audit invariant missing ${token}`);
}

if (!sql.includes('approver_employee_id') || !sql.includes('requester_employee_id')) {
  throw new Error('approval schema must persist requester and approver identities separately');
}

if (!sql.includes('revoke all on table public.admin_audit_events from public, anon, authenticated')) {
  throw new Error('audit table must be browser-deny-by-default');
}

if (sql.includes('delete from public.admin_audit_events')) {
  throw new Error('audit history must not expose destructive deletion');
}

if (!databaseUrl) {
  console.log('Admin Plan 3 approvals/audit static invariant passed.');
  process.exit(0);
}

const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Admin Plan 3 behavioral test refuses non-loopback PostgreSQL.');
}

const behaviorSql = String.raw`
begin;

-- Browser roles must not have direct table authority over approval/audit state.
do $$
declare
  v_role text;
  v_table text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_table in array array[
      'admin_audit_events',
      'admin_approval_rules',
      'admin_approval_requests',
      'admin_approval_execution_jobs'
    ] loop
      if has_table_privilege(v_role, 'public.' || v_table, 'SELECT')
        or has_table_privilege(v_role, 'public.' || v_table, 'INSERT')
        or has_table_privilege(v_role, 'public.' || v_table, 'UPDATE')
        or has_table_privilege(v_role, 'public.' || v_table, 'DELETE') then
        raise exception 'browser role % has direct privilege on %', v_role, v_table;
      end if;
    end loop;
  end loop;
end $$;

-- Browser roles must not execute trusted approval/audit mutation RPCs.
do $$
declare
  v_role text;
  v_proc oid;
  v_name text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_name in array array[
      'create_admin_approval_request_v1',
      'decide_admin_approval_request_v1',
      'claim_admin_approval_execution_v1',
      'complete_admin_approval_execution_v1',
      'append_admin_audit_event_v1'
    ] loop
      for v_proc in
        select p.oid
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = v_name
      loop
        if has_function_privilege(v_role, v_proc, 'EXECUTE') then
          raise exception 'browser role % can execute trusted RPC %', v_role, v_name;
        end if;
      end loop;
    end loop;
  end loop;
end $$;

insert into public.business_employees(id, business_id, display_name, role, active)
values
  (
    '31000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'Plan 3 Requester',
    'OWNER',
    true
  ),
  (
    '31000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001',
    'Plan 3 Approver',
    'OWNER',
    true
  );

insert into public.admin_approval_rules(
  id,
  business_id,
  action_type,
  requester_permission,
  approver_permission,
  requires_second_person,
  expires_after_seconds
) values
  (
    '33000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'PLAN3_SELF_APPROVAL_TEST',
    'settings.manage',
    'approvals.review',
    true,
    3600
  ),
  (
    '33000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001',
    'PLAN3_RUNTIME_TEST',
    'settings.manage',
    'approvals.review',
    true,
    3600
  );

-- Append-only means even trusted direct SQL cannot rewrite an emitted audit fact.
do $$
declare
  v_audit_id uuid;
  v_blocked boolean;
begin
  insert into public.admin_audit_events(
    business_id, actor_employee_id, action_type, entity_type, entity_id, after_value
  ) values (
    '00000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000001',
    'PLAN3_TEST',
    'TEST',
    'immutable-1',
    '{"ok":true}'::jsonb
  ) returning id into v_audit_id;

  v_blocked := false;
  begin
    update public.admin_audit_events set reason = 'rewritten' where id = v_audit_id;
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'admin_audit_events update was not blocked';
  end if;

  v_blocked := false;
  begin
    delete from public.admin_audit_events where id = v_audit_id;
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'admin_audit_events delete was not blocked';
  end if;
end $$;

-- Secret-bearing generic audit metadata must fail closed.
do $$
declare
  v_blocked boolean := false;
begin
  begin
    insert into public.admin_audit_events(
      business_id, actor_employee_id, action_type, after_value
    ) values (
      '00000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000001',
      'PLAN3_SECRET_TEST',
      '{"pin":"482731"}'::jsonb
    );
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'secret-bearing audit metadata was persisted';
  end if;
end $$;

-- Second-person approval is a database invariant, including OWNER requesters.
do $$
declare
  v_blocked boolean := false;
  v_constraint text;
begin
  begin
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
      expires_at
    ) values (
      '00000000-0000-4000-8000-000000000001',
      '33000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000001',
      'PLAN3_SELF_APPROVAL_TEST',
      '32000000-0000-4000-8000-000000000001',
      '{}'::jsonb,
      'approvals.review',
      true,
      'APPROVED',
      '31000000-0000-4000-8000-000000000001',
      now(),
      now() + interval '1 hour'
    );
  exception when check_violation then
    get stacked diagnostics v_constraint = CONSTRAINT_NAME;
    v_blocked := v_constraint = 'admin_approval_requests_distinct_approver_ck';
  end;

  if not v_blocked then
    raise exception 'requester self-approval was not blocked by the distinct-approver invariant';
  end if;
end $$;

-- Generic persisted command payloads reject raw PIN/verifier-style material.
do $$
declare
  v_result jsonb;
begin
  select public.create_admin_approval_request_v1(
    '00000000-0000-4000-8000-000000000001',
    null,
    '31000000-0000-4000-8000-000000000001',
    null,
    '33000000-0000-4000-8000-000000000002',
    'PLAN3_RUNTIME_TEST',
    '32000000-0000-4000-8000-000000000002',
    '{"pin":"482731"}'::jsonb,
    'must not persist'
  ) into v_result;

  if v_result ->> 'code' <> 'secret_payload_forbidden' then
    raise exception 'secret-bearing command payload did not fail closed: %', v_result;
  end if;
end $$;

-- Full durable path: self-decision denied, second person approves exactly one job,
-- live lease cannot be stolen, expired lease is reclaimable, stale completion loses,
-- and the winning completion is idempotent by the final hashed claim identity.
do $$
declare
  v_request jsonb;
  v_decision jsonb;
  v_request_id uuid;
  v_first record;
  v_second record;
  v_live_steal_count integer;
  v_completion jsonb;
  v_job_count integer;
  v_now timestamptz := '2026-09-16T12:00:00Z'::timestamptz;
begin
  select public.create_admin_approval_request_v1(
    '00000000-0000-4000-8000-000000000001',
    null,
    '31000000-0000-4000-8000-000000000001',
    null,
    '33000000-0000-4000-8000-000000000002',
    'PLAN3_RUNTIME_TEST',
    '32000000-0000-4000-8000-000000000003',
    '{"safeValue":42}'::jsonb,
    'runtime proof'
  ) into v_request;

  if coalesce((v_request ->> 'ok')::boolean, false) is not true then
    raise exception 'approval request creation failed: %', v_request;
  end if;
  v_request_id := (v_request ->> 'requestId')::uuid;

  select public.decide_admin_approval_request_v1(
    v_request_id,
    '31000000-0000-4000-8000-000000000001',
    null,
    'APPROVE',
    'self attempt'
  ) into v_decision;
  if v_decision ->> 'code' <> 'self_approval_forbidden' then
    raise exception 'self approval did not return stable code: %', v_decision;
  end if;

  select public.decide_admin_approval_request_v1(
    v_request_id,
    '31000000-0000-4000-8000-000000000002',
    null,
    'APPROVE',
    'approved by second person'
  ) into v_decision;
  if coalesce((v_decision ->> 'ok')::boolean, false) is not true
     or v_decision ->> 'status' <> 'APPROVED' then
    raise exception 'second-person approval failed: %', v_decision;
  end if;

  select count(*) into v_job_count
  from public.admin_approval_execution_jobs
  where approval_request_id = v_request_id;
  if v_job_count <> 1 then
    raise exception 'approval created % execution jobs instead of exactly one', v_job_count;
  end if;

  select * into v_first
  from public.claim_admin_approval_execution_v1('worker-a', v_now, 1, 30);
  if v_first.approval_request_id is distinct from v_request_id
     or v_first.attempt_count <> 1
     or nullif(v_first.claim_token, '') is null then
    raise exception 'first durable claim invalid';
  end if;

  select count(*) into v_live_steal_count
  from public.claim_admin_approval_execution_v1('worker-b', v_now + interval '29 seconds', 1, 30);
  if v_live_steal_count <> 0 then
    raise exception 'live approval execution lease was stolen';
  end if;

  select * into v_second
  from public.claim_admin_approval_execution_v1('worker-b', v_now + interval '31 seconds', 1, 30);
  if v_second.approval_request_id is distinct from v_request_id
     or v_second.attempt_count <> 2
     or v_second.claim_token = v_first.claim_token then
    raise exception 'expired lease was not safely reclaimed';
  end if;

  select public.complete_admin_approval_execution_v1(
    v_request_id,
    v_first.claim_token,
    'EXECUTED',
    null,
    '{"effect":"done"}'::jsonb,
    v_now + interval '32 seconds'
  ) into v_completion;
  if v_completion ->> 'code' <> 'stale_or_invalid_claim' then
    raise exception 'stale claimant was allowed to complete: %', v_completion;
  end if;

  select public.complete_admin_approval_execution_v1(
    v_request_id,
    v_second.claim_token,
    'EXECUTED',
    null,
    '{"effect":"done"}'::jsonb,
    v_now + interval '33 seconds'
  ) into v_completion;
  if coalesce((v_completion ->> 'ok')::boolean, false) is not true
     or v_completion ->> 'status' <> 'EXECUTED' then
    raise exception 'winning claimant could not complete: %', v_completion;
  end if;

  select public.complete_admin_approval_execution_v1(
    v_request_id,
    v_second.claim_token,
    'EXECUTED',
    null,
    '{"effect":"done"}'::jsonb,
    v_now + interval '34 seconds'
  ) into v_completion;
  if coalesce((v_completion ->> 'idempotentReplay')::boolean, false) is not true then
    raise exception 'completion replay did not converge idempotently: %', v_completion;
  end if;

  if not exists (
    select 1
    from public.admin_approval_requests r
    join public.admin_approval_execution_jobs j on j.approval_request_id = r.id
    where r.id = v_request_id
      and r.status = 'EXECUTED'
      and j.state = 'EXECUTED'
      and j.attempt_count = 2
      and j.claim_token_hash is null
      and j.completed_claim_token_hash ~ '^[0-9a-f]{64}$'
  ) then
    raise exception 'terminal durable execution state is inconsistent';
  end if;

  if not exists (
    select 1 from public.admin_audit_events a
    where a.approval_request_id = v_request_id
      and a.action_type = 'APPROVAL_COMMAND_EXECUTED'
      and a.actor_kind = 'SYSTEM'
  ) then
    raise exception 'successful approval execution did not append linked audit history';
  end if;
end $$;

-- One durable execution identity per command is required for at-most-once dispatch.
do $$
begin
  if not exists (
    select 1
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'admin_approval_execution_jobs'
      and i.indisunique
      and pg_get_indexdef(i.indexrelid) ilike '%command_id%'
  ) then
    raise exception 'admin_approval_execution_jobs.command_id lacks a unique fence';
  end if;
end $$;

rollback;
`;

const result = spawnSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-X', '-q'], {
  input: behaviorSql,
  encoding: 'utf8',
});
if (result.status !== 0) {
  process.stderr.write(`${result.stdout ?? ''}${result.stderr ?? ''}`);
  process.exit(1);
}

console.log('Admin Plan 3 approvals/audit PostgreSQL behavior passed.');
