import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
const url = process.env.TEST_DATABASE_URL;
if (!url || !['127.0.0.1','localhost','::1'].includes(new URL(url).hostname)) throw new Error('Isolated loopback TEST_DATABASE_URL required.');
function sql(source, name) {
  const r = spawnSync('psql',[url,'-X','-v','ON_ERROR_STOP=1','-f','-'],{input:source,encoding:'utf8',maxBuffer:8388608});
  if (r.status !== 0) throw new Error(name + ': ' + r.stderr + r.stdout);
  return r.stdout;
}
sql([
'drop schema if exists public cascade;','drop schema if exists private cascade;',
'drop schema if exists auth cascade;','drop schema if exists storage cascade;',
'create schema public; create schema private; create schema auth; create schema storage;',
'create table auth.users(id uuid primary key);',
'create table storage.buckets(id text primary key,name text not null unique,public boolean not null default false);',
"do $body$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon noinherit; end if; if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated noinherit; end if; if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role noinherit; end if; end $body$;",
'grant usage on schema public to anon,authenticated,service_role;',
"create function auth.uid() returns uuid language sql stable as $body$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $body$;"
].join('\n'),'schema bootstrap');
for (const name of readdirSync(resolve('supabase/migrations')).filter((x)=>/^\d+_.+\.sql$/.test(x)).sort()) {
  sql(readFileSync(resolve('supabase/migrations',name),'utf8'),name);
}
console.log(sql(readFileSync(resolve('scripts/operations-business-day-sync-postgres.sql'),'utf8'),'business-day RPC acceptance'));
