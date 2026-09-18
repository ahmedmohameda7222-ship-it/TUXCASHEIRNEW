import { spawnSync } from 'node:child_process';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required');

const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Admin Plan 3 round-13 hardening test refuses non-loopback PostgreSQL.');
}

const result = spawnSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-X', '-q'], {
  input: String.raw`
begin;
do $$
declare
  v_result text;
begin
  if to_regprocedure(
    'public.list_admin_audit_events_v4(uuid,uuid[],boolean,uuid,uuid,text,text,text,timestamptz,timestamptz,text,uuid,timestamptz,uuid,integer)'
  ) is null then
    raise exception 'audit events v4 RPC is missing';
  end if;

  select pg_get_function_result(
    'public.list_admin_audit_events_v4(uuid,uuid[],boolean,uuid,uuid,text,text,text,timestamptz,timestamptz,text,uuid,timestamptz,uuid,integer)'::regprocedure
  ) into v_result;

  if position('session_id uuid' in lower(v_result)) = 0 then
    raise exception 'audit events v4 result omits session_id';
  end if;
  if position('context_metadata jsonb' in lower(v_result)) = 0 then
    raise exception 'audit events v4 result omits context_metadata';
  end if;
end $$;
rollback;
`,
  encoding: 'utf8',
});

if (result.status !== 0) {
  process.stderr.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  process.exit(result.status ?? 1);
}

console.log('Admin Plan 3 review round-13 PostgreSQL hardening passed.');
