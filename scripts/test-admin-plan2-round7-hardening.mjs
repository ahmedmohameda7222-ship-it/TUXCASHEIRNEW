import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const migrationPath =
  'supabase/migrations/20260910122100_admin_plan2_final_review_round7_hardening.sql';
if (!fs.existsSync(migrationPath)) {
  throw new Error(`Plan 2 round 7 hardening migration is missing: ${migrationPath}`);
}

const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();
for (const fragment of [
  'catalog_public_local_second_v1',
  'catalog_public_online_ordering_open_v1',
  'v_second_of_day',
  'extract(second from v_local)',
  'v_second >= 60',
]) {
  if (!sql.includes(fragment)) {
    throw new Error(`Plan 2 round 7 hardening missing ${fragment}`);
  }
}

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('Plan 2 round 7 hardening static invariant passed.');
  process.exit(0);
}

const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Plan 2 round 7 behavioral test refuses non-loopback PostgreSQL.');
}

const behaviorSql = String.raw`
begin;

do $$
declare
  v_settings jsonb := jsonb_build_object(
    'weeklyHours', jsonb_build_array(
      jsonb_build_object(
        'serviceKind', 'ONLINE',
        'dayOfWeek', 1,
        'timezone', 'Africa/Cairo',
        'opensLocal', '12:30:30.500',
        'closesLocal', '12:31:30.500',
        'active', true
      )
    ),
    'specialHours', '[]'::jsonb
  );
begin
  if private.catalog_public_local_second_v1('12:30:30.500') <> 45030.500 then
    raise exception 'second parser discarded fractional precision';
  end if;
  if private.catalog_public_local_second_v1('12:30:60') is not null then
    raise exception 'second parser accepted an invalid 60-second field';
  end if;

  if private.catalog_public_online_ordering_open_v1(
       v_settings, timestamptz '2026-01-05 10:30:30.499+00'
     ) is not false then
    raise exception 'ONLINE interval opened before the configured fractional second';
  end if;
  if private.catalog_public_online_ordering_open_v1(
       v_settings, timestamptz '2026-01-05 10:30:30.500+00'
     ) is not true then
    raise exception 'ONLINE interval did not open at the configured fractional second';
  end if;
  if private.catalog_public_online_ordering_open_v1(
       v_settings, timestamptz '2026-01-05 10:31:30.499+00'
     ) is not true then
    raise exception 'ONLINE interval closed before the configured fractional second';
  end if;
  if private.catalog_public_online_ordering_open_v1(
       v_settings, timestamptz '2026-01-05 10:31:30.500+00'
     ) is not false then
    raise exception 'ONLINE interval remained open at the exclusive close boundary';
  end if;
end $$;

rollback;
`;

const result = spawnSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-X', '-q'], {
  input: behaviorSql,
  encoding: 'utf8',
});
if (result.status !== 0) {
  process.stderr.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  process.exit(result.status ?? 1);
}

console.log('Plan 2 round 7 hardening PostgreSQL behavior passed.');
