import { spawnSync } from 'node:child_process';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required');

const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Admin Plan 3 round-10 hardening test refuses non-loopback PostgreSQL.');
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

const apiCredentialCheck = String.raw`
begin;
do $$
begin
  if private.admin_text_contains_secret_v1('API key: sk_live_1234') is not true then
    raise exception 'API key disclosure was not detected';
  end if;
  if private.admin_text_contains_secret_v1('client secret is super-secret-value') is not true then
    raise exception 'client secret disclosure was not detected';
  end if;
  if private.admin_text_contains_secret_v1('access key = AKIAEXAMPLE1234') is not true then
    raise exception 'access key disclosure was not detected';
  end if;
  if private.admin_text_contains_secret_v1('Inventory key count adjusted') is not false then
    raise exception 'ordinary inventory key reason was incorrectly classified as secret';
  end if;
end $$;
rollback;
`;

const structuredCredentialCheck = String.raw`
begin;
do $$
begin
  if private.admin_json_contains_secret_key_v1('{"apiKey":"sk_live_1234"}'::jsonb) is not true then
    raise exception 'structured apiKey disclosure was not detected';
  end if;
  if private.admin_json_contains_secret_key_v1('{"clientSecret":"client-secret"}'::jsonb) is not true then
    raise exception 'structured clientSecret disclosure was not detected';
  end if;
  if private.admin_json_contains_secret_key_v1('{"accessKey":"AKIAEXAMPLE"}'::jsonb) is not true then
    raise exception 'structured accessKey disclosure was not detected';
  end if;
  if private.admin_json_contains_secret_key_v1('{"secretKey":"secret-value"}'::jsonb) is not true then
    raise exception 'structured secretKey disclosure was not detected';
  end if;
  if private.admin_json_contains_secret_key_v1('{"privateKey":"private-value"}'::jsonb) is not true then
    raise exception 'structured privateKey disclosure was not detected';
  end if;
  if private.admin_json_contains_secret_key_v1('{"apiVersion":"v2","clientName":"register"}'::jsonb) is not false then
    raise exception 'ordinary structured metadata was incorrectly classified as secret';
  end if;
end $$;
rollback;
`;

const auditPaginationRpcCheck = String.raw`
begin;
do $$
begin
  if to_regprocedure(
    'public.list_admin_audit_events_v3(uuid,uuid[],boolean,uuid,uuid,text,text,text,timestamptz,timestamptz,text,uuid,timestamptz,uuid,integer)'
  ) is null then
    raise exception 'cursor-aware audit events v3 RPC is missing';
  end if;
end $$;
rollback;
`;

const results = [
  ['API credential reason rejection', apiCredentialCheck],
  ['structured API credential rejection', structuredCredentialCheck],
  ['cursor-aware audit pagination RPC', auditPaginationRpcCheck],
].map(([label, sql]) => runCheck(label, sql));

if (results.some((passed) => !passed)) process.exit(1);
console.log('Admin Plan 3 review round-10/11 PostgreSQL hardening passed.');
