import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log('Production parity PostgreSQL test skipped without TEST_DATABASE_URL.');
  process.exit(0);
}
assert.ok(['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname),
  'Production parity fixtures must never touch a non-loopback database.');

function run(program, args, label) {
  const out = spawnSync(program, args, { encoding: 'utf8' });
  assert.equal(out.status, 0, `${label} failed:\n${out.stdout}\n${out.stderr}`);
  return out.stdout.trim();
}
const psql = (args, label) => run('psql', [url, '-X', '-v', 'ON_ERROR_STOP=1', ...args], label);
const scalar = (sql) => psql(['-At', '-c', sql], 'SQL assertion');
const rpc = (sql) => JSON.parse(scalar(`select (${sql})::text`));

run('node', ['scripts/test-admin-workforce-reactivation-postgres.mjs'],
  'Reviewed Workforce reactivation security/lifecycle fixture');

// Exercise the NEW reconciliation files as an ordered forward-only chain
// against a disposable PostgreSQL fixture that predates this correction.
for (const file of [
  '20261010184417_admin_order_terminal_parity_reconciliation.sql',
  '20261010184435_admin_workforce_scope_parity.sql',
  '20261010184440_admin_workforce_mutation_parity.sql',
  '20261010184445_admin_workforce_operations_parity.sql',
]) psql(['-f', resolve('supabase/migrations', file)], file);

const names = [
  ['private','workforce_target_role_denial_v1'],
  ['private','workforce_global_target_denial_v1'],
  ['private','workforce_operations_setup_required_v1'],
  ['public','get_employee_worker_state_fingerprint_v1'],
  ['public','reactivate_employee_worker_v1'],
];
for (const [schema, name] of names) {
  assert.equal(scalar(`select count(*) from pg_proc p join pg_namespace n
      on n.oid=p.pronamespace where n.nspname='${schema}' and p.proname='${name}'`), '1',
    `Expected reconciled function ${schema}.${name}`);
}
assert.equal(scalar(`select (position('INHERIT' in pg_get_functiondef(
  'public.set_employee_permission_v1(uuid,uuid,uuid,bigint,text,text,text)'::regprocedure)) > 0)::text`),
'true', 'INHERIT permission override must exist');
assert.equal(scalar(`select (position('workforce_global_target_denial_v1' in pg_get_functiondef(
  'public.assign_employee_to_shop_v1(uuid,uuid,uuid,text)'::regprocedure)) > 0)::text`),
'true', 'Assignment must enforce complete target scope');
for (const fn of ['assign_employee_to_shop_v1(uuid,uuid,uuid,text)',
  'reactivate_employee_worker_v1(uuid,uuid,uuid,uuid,bigint,bigint,text)']) {
  assert.equal(scalar(`select (not has_function_privilege('anon','public.${fn}','EXECUTE')
    and not has_function_privilege('authenticated','public.${fn}','EXECUTE')
    and has_function_privilege('service_role','public.${fn}','EXECUTE'))::text`), 'true',
    `Browser execution boundary incorrect on ${fn}`);
}
assert.equal(scalar(`select count(*) from pg_trigger t join pg_class c
  on c.oid=t.tgrelid where c.relname='admin_approval_requests'
  and t.tgname='admin_order_terminal_approval_receipt' and not t.tgisinternal`), '1',
'Terminal approval trigger missing');
for (const table of ['admin_order_refunds','admin_order_returns']) {
  assert.equal(scalar(`select (position('REJECTED' in pg_get_constraintdef(c.oid))>0
    and position('FAILED' in pg_get_constraintdef(c.oid))>0)::text
    from pg_constraint c where c.conrelid='public.${table}'::regclass
    and c.conname='${table}_state_check'`), 'true', `${table} terminal state check incomplete`);
}

const B = '71000000-0000-4000-8000-000000000001';
const A = '72000000-0000-4000-8000-000000000001';
const SHOP_B = '72000000-0000-4000-8000-000000000002';
const TARGET = '73000000-0000-4000-8000-000000000002';
const ADMIN_B = '73000000-0000-4000-8000-000000000007';
const OWNER = '73000000-0000-4000-8000-000000000001';
psql(['-c', `insert into public.business_employees(id,business_id,display_name,role,pin_lookup_hash,pin_hash,active)
  values('${ADMIN_B}','${B}','B-only admin','ADMIN',repeat('9',64),
    'pbkdf2-sha256$210000$' || repeat('9',32) || '$' || repeat('9',64),true);
  insert into public.employee_shop_assignments(business_id,employee_id,shop_id)
  values('${B}','${ADMIN_B}','${SHOP_B}');`], 'Scope-pivot fixture');

const pivot = rpc(`public.assign_employee_to_shop_v1(
  '${ADMIN_B}','${TARGET}','${SHOP_B}','parity-deny-shop-pivot')`);
assert.equal(pivot.ok, false, `Shop B manager pivoted an employee of Shop A: ${JSON.stringify(pivot)}`);
assert.equal(scalar(`select count(*) from public.employee_shop_assignments where
  employee_id='${TARGET}' and shop_id='${SHOP_B}'`), '0',
'Denied Shop B pivot unexpectedly created an assignment');
const hierarchy = rpc(`public.assign_employee_to_shop_v1(
  '${ADMIN_B}','${OWNER}','${SHOP_B}','parity-deny-owner-hierarchy')`);
assert.equal(hierarchy.ok, false, 'ADMIN must never assign an OWNER target');
assert.equal(hierarchy.code, 'role_escalation_forbidden');

console.log('Forward-only Workforce and order-approval reconciliation parity PostgreSQL smoke passed.');
