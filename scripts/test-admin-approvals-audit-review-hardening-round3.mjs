import { spawnSync } from 'node:child_process';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required');

const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Admin Plan 3 round-3 hardening test refuses non-loopback PostgreSQL.');
}

const sql = String.raw`
do $$
begin
  if private.admin_text_contains_secret_v1('PIN: 4827') is not true then
    raise exception '4-digit PIN reason text was not detected';
  end if;
  if private.admin_text_contains_secret_v1('PIN: 123456789012') is not true then
    raise exception '12-digit PIN reason text was not detected';
  end if;
  if private.admin_text_contains_secret_v1('Reviewed inventory count discrepancy') is not false then
    raise exception 'safe audit reason was incorrectly classified as secret';
  end if;
end $$;
`;

const result = spawnSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-X', '-q'], {
  input: sql,
  encoding: 'utf8',
});

if (result.status !== 0) {
  process.stderr.write(`${result.stdout ?? ''}${result.stderr ?? ''}`);
  process.exit(result.status ?? 1);
}
