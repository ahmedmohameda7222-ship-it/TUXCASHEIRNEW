import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const migrationPath = 'supabase/migrations/20260910125000_admin_approvals_audit.sql';
const databaseUrl = process.env.TEST_DATABASE_URL;

// Task 1 RED is intentionally ENOENT until the Plan 3 migration exists.
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
]) {
  if (!sql.includes(token)) throw new Error(`durable approval/audit invariant missing ${token}`);
}

if (!sql.includes('approver_employee_id') || !sql.includes('requester_employee_id')) {
  throw new Error('approval schema must persist requester and approver identities separately');
}

for (const role of ['anon', 'authenticated']) {
  if (!sql.includes(`revoke all on table public.admin_audit_events from public, anon, authenticated`)) {
    throw new Error(`audit table must be browser-deny-by-default (${role})`);
  }
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

-- Browser roles must not be able to execute trusted approval/audit mutation RPCs.
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

-- Append-only means even trusted direct SQL cannot silently rewrite an emitted audit fact.
do $$
declare
  v_audit_id uuid;
  v_blocked boolean;
begin
  insert into public.business_employees(id, business_id, display_name, role, active)
  values (
    '31000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'Plan 3 Audit Actor',
    'OWNER',
    true
  );

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

-- Second-person approval must be a database invariant too, including OWNER requesters.
do $$
declare
  v_blocked boolean := false;
begin
  begin
    insert into public.admin_approval_requests(
      business_id,
      requester_employee_id,
      action_type,
      command_id,
      command_payload,
      status,
      approver_employee_id,
      decided_at
    ) values (
      '00000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000001',
      'PLAN3_SELF_APPROVAL_TEST',
      '32000000-0000-4000-8000-000000000001',
      '{}'::jsonb,
      'APPROVED',
      '31000000-0000-4000-8000-000000000001',
      now()
    );
  exception when others then
    v_blocked := true;
  end;

  if not v_blocked then
    raise exception 'requester self-approval was not blocked by database invariant';
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
