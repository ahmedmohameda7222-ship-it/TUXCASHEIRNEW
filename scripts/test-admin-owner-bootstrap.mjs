import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const cliPath = 'scripts/bootstrap-admin-owner.mjs';
const businessMigrationPath = 'supabase/migrations/20260910100000_admin_business_auth.sql';
const migrationPath = 'supabase/migrations/20260910100100_admin_owner_bootstrap.sql';
const cli = readFileSync(cliPath, 'utf8');
const sql = readFileSync(migrationPath, 'utf8').toLowerCase();

for (const required of [
  'bootstrap_tux_admin_owner_v1',
  'pg_advisory_xact_lock',
  "role = 'owner'",
  'to service_role',
]) {
  if (!sql.includes(required)) throw new Error(`missing bootstrap migration invariant: ${required}`);
}

if (!/revoke\s+(?:all|execute)\s+on\s+function\s+public\.bootstrap_tux_admin_owner_v1[\s\S]*?from\s+public\s*,\s*anon\s*,\s*authenticated/i.test(sql)) {
  throw new Error('OWNER bootstrap RPC must revoke browser/public execution');
}
if (!/grant\s+execute\s+on\s+function\s+public\.bootstrap_tux_admin_owner_v1[\s\S]*?to\s+service_role/i.test(sql)) {
  throw new Error('OWNER bootstrap RPC must be service-role only');
}

for (const required of [
  'setRawMode',
  'pbkdf2-sha256',
  '210_000',
  'bootstrap_tux_admin_owner_v1',
  'TUX_ADMIN_PIN_LOOKUP_SECRET',
]) {
  if (!cli.includes(required)) throw new Error(`missing secure bootstrap CLI behavior: ${required}`);
}

if (/--pin(?:\s|=)/i.test(cli)) throw new Error('bootstrap CLI must never accept the PIN as a command argument');
if (/console\.(?:log|error|warn)\s*\(\s*(?:entered)?pin\b/i.test(cli)) {
  throw new Error('bootstrap CLI must never print the entered PIN');
}
if (/JSON\.stringify\s*\(\s*\{[\s\S]{0,500}\bpin\s*[,}:]/i.test(cli)) {
  throw new Error('bootstrap CLI must submit hashes only, never plaintext PIN');
}
if (/\b(?:pin|defaultPin|ownerPin)\s*=\s*['"]\d{4,12}['"]/i.test(cli)) {
  throw new Error('bootstrap CLI must not contain a literal/default production PIN');
}

function runPsql(databaseUrl, args, failureMessage) {
  const result = spawnSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    throw new Error(`${failureMessage} with exit code ${result.status ?? 'unknown'}.`);
  }
}

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl) {
  const url = new URL(databaseUrl);
  if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
    throw new Error('OWNER bootstrap DB test refuses non-loopback PostgreSQL.');
  }

  // Keep this behavioral test independent from earlier migration tests. Some repository
  // migration fixtures intentionally rebuild the database only through their own target
  // migration, so the Admin bootstrap prerequisites must be established here explicitly.
  for (const requiredMigration of [businessMigrationPath, migrationPath]) {
    runPsql(databaseUrl, ['-f', requiredMigration], `Failed applying ${requiredMigration}`);
  }

  const lookupOne = '1'.repeat(64);
  const lookupTwo = '2'.repeat(64);
  const verifier = `pbkdf2-sha256$210000$${'a'.repeat(32)}$${'b'.repeat(64)}`;
  const statement = `
    do $$
    declare
      v_owner_id uuid;
      v_duplicate_blocked boolean := false;
    begin
      select public.bootstrap_tux_admin_owner_v1(
        '00000000-0000-4000-8000-000000000001'::uuid,
        'Migration Smoke Owner',
        '${lookupOne}',
        '${verifier}'
      ) into v_owner_id;

      if v_owner_id is null then
        raise exception 'first OWNER bootstrap returned no employee id';
      end if;
      if (
        select count(*) from public.business_employees
        where business_id = '00000000-0000-4000-8000-000000000001'::uuid
          and role = 'OWNER' and active
      ) <> 1 then
        raise exception 'first OWNER bootstrap did not create exactly one active OWNER';
      end if;

      begin
        perform public.bootstrap_tux_admin_owner_v1(
          '00000000-0000-4000-8000-000000000001'::uuid,
          'Second Migration Smoke Owner',
          '${lookupTwo}',
          '${verifier}'
        );
      exception when others then
        if position('TUX_ADMIN_OWNER_ALREADY_EXISTS' in sqlerrm) > 0 then
          v_duplicate_blocked := true;
        else
          raise;
        end if;
      end;
      if not v_duplicate_blocked then
        raise exception 'duplicate OWNER bootstrap unexpectedly succeeded';
      end if;

      if has_function_privilege(
        'anon', 'public.bootstrap_tux_admin_owner_v1(uuid,text,text,text)', 'EXECUTE'
      ) then
        raise exception 'anon unexpectedly has OWNER bootstrap EXECUTE';
      end if;
      if has_function_privilege(
        'authenticated', 'public.bootstrap_tux_admin_owner_v1(uuid,text,text,text)', 'EXECUTE'
      ) then
        raise exception 'authenticated unexpectedly has OWNER bootstrap EXECUTE';
      end if;
      if not has_function_privilege(
        'service_role', 'public.bootstrap_tux_admin_owner_v1(uuid,text,text,text)', 'EXECUTE'
      ) then
        raise exception 'service_role lacks OWNER bootstrap EXECUTE';
      end if;
    end $$;
  `;

  runPsql(databaseUrl, ['-c', statement], 'OWNER bootstrap DB assertions failed');
}

console.log('Admin OWNER bootstrap invariants passed.');
