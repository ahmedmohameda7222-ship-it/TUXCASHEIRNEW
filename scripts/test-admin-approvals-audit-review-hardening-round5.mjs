import { spawnSync } from 'node:child_process';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required');

const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Admin Plan 3 round-5 hardening test refuses non-loopback PostgreSQL.');
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

const passwordConnectorCheck = String.raw`
begin;
do $$
begin
  if private.admin_text_contains_secret_v1('password is hunter2') is not true then
    raise exception 'password connector phrase was not detected';
  end if;
  if private.admin_text_contains_secret_v1('verifier equals pbkdf2-secret-value') is not true then
    raise exception 'verifier connector phrase was not detected';
  end if;
  if private.admin_text_contains_secret_v1('Reviewed inventory discrepancy') is not false then
    raise exception 'safe reason was incorrectly classified as secret';
  end if;
end $$;
rollback;
`;

const historicalActorOptionsCheck = String.raw`
begin;
do $$
begin
  if to_regprocedure('public.list_admin_audit_actor_options_v1(uuid,uuid[])') is null then
    raise exception 'historical audit actor options RPC is missing';
  end if;
end $$;
rollback;
`;

const results = [
  ['password connector detection', passwordConnectorCheck],
  ['historical actor options RPC', historicalActorOptionsCheck],
].map(([label, sql]) => runCheck(label, sql));

if (results.some((passed) => !passed)) process.exit(1);
