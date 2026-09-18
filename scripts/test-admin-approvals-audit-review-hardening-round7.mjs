import { spawnSync } from 'node:child_process';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required');

const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Admin Plan 3 round-7 hardening test refuses non-loopback PostgreSQL.');
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

const narrativeCredentialCheck = String.raw`
begin;
do $$
begin
  if private.admin_text_contains_secret_v1('password is now hunter2') is not true then
    raise exception 'password narrative with an intervening connector was not detected';
  end if;
  if private.admin_text_contains_secret_v1('PIN4827') is not true then
    raise exception 'compact PIN disclosure was not detected';
  end if;
  if private.admin_text_contains_secret_v1('passcode1234') is not true then
    raise exception 'compact passcode disclosure was not detected';
  end if;
  if private.admin_text_contains_secret_v1('Reviewed inventory discrepancy') is not false then
    raise exception 'safe inventory reason was incorrectly classified as secret';
  end if;
  if private.admin_text_contains_secret_v1('Salt inventory count adjusted') is not false then
    raise exception 'ordinary restaurant salt reason was incorrectly classified as secret';
  end if;
end $$;
rollback;
`;

const results = [['bounded credential narrative rejection', narrativeCredentialCheck]].map(
  ([label, sql]) => runCheck(label, sql),
);

if (results.some((passed) => !passed)) process.exit(1);
console.log('Admin Plan 3 review round-7 PostgreSQL hardening passed.');