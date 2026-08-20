import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL is required for migration smoke testing.');
}
const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Migration smoke refuses to reset a non-loopback PostgreSQL database.');
}

const migrationsDirectory = resolve('supabase/migrations');
const migrations = readdirSync(migrationsDirectory)
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort();
if (migrations.length === 0) throw new Error('No repository migrations were found.');

function psql(args, label) {
  const result = spawnSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}.`);
  }
  return result.stdout;
}

psql(
  [
    '-c',
    `drop schema if exists public cascade;
     create schema public;
     drop schema if exists auth cascade;
     create schema auth;
     create table auth.users(id uuid primary key);`,
  ],
  'Fresh database reset and Supabase auth compatibility stub',
);

for (const migration of migrations) {
  process.stdout.write(`Applying ${migration}\n`);
  psql(['-f', resolve(migrationsDirectory, migration)], migration);
}

psql(
  [
    '-c',
    `do $$
     begin
       if to_regclass('public.operations_sync_event_receipts') is null then
         raise exception 'operations_sync_event_receipts missing';
       end if;
       if not exists (
         select 1 from pg_constraint where conname = 'orders_business_day_same_shop_fk' and contype = 'f'
       ) then
         raise exception 'orders composite tenant FK missing';
       end if;
       if not exists (
         select 1 from pg_constraint where conname = 'orders_return_metadata_ck' and contype = 'c'
       ) then
         raise exception 'orders lifecycle constraint missing';
       end if;
       if not exists (
         select 1 from pg_indexes
         where schemaname = 'public' and indexname = 'worker_sessions_one_open_per_business_day_idx'
       ) then
         raise exception 'worker session unique-open index missing';
       end if;
       if not exists (
         select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = 'orders' and c.relrowsecurity
       ) then
         raise exception 'orders RLS is not enabled';
       end if;
       if not exists (
         select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = 'operations_sync_event_receipts' and c.relrowsecurity
       ) then
         raise exception 'sync receipts RLS is not enabled';
       end if;
     end $$;`,
  ],
  'Post-migration invariant assertions',
);

process.stdout.write(`Migration smoke passed: ${migrations.join(' -> ')}\n`);
