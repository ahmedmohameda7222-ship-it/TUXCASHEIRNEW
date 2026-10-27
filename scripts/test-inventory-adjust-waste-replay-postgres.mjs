import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

// An exclusively disposable, loopback PostgreSQL acceptance. Never connect
// this test to the canonical Supabase project or any remote database.
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('I3 replay acceptance requires TEST_DATABASE_URL');
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(new URL(databaseUrl).hostname)) {
  throw new Error('I3 replay acceptance refuses non-loopback databases');
}

function execute(args, purpose, mustFail = false, expectedError = '') {
  const result = spawnSync('psql', [databaseUrl, '-X', '-q', '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  if ((!mustFail && result.status !== 0) ||
      (mustFail && (result.status === 0 || !output.includes(expectedError)))) {
    throw new Error(purpose + ' failed: ' + output.slice(-3000));
  }
  return (result.stdout ?? '').trim();
}

function sql(statement, purpose = 'I3 database query') {
  return execute(['-At', '-c', statement], purpose);
}

function literal(value) {
  if (value === null) return 'NULL';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return "'" + String(value).replaceAll("'", "''") + "'";
}

function call(name, ...values) {
  const args = values.map(literal).join(',');
  return JSON.parse(sql('select (public.' + name + '(' + args + '))::text;', name));
}

function verify(condition, description) {
  if (!condition) throw new Error(description);
}
function equal(actual, expected, description) {
  if (actual !== expected) {
    throw new Error(description + ': expected ' + expected + ' but received ' + actual);
  }
}

// The existing six-migration isolated fixture verifies transfers, recipe
// reservation replay and post-shift stocktakes, and leaves a disposable DB.
const setup = spawnSync(process.execPath, ['scripts/test-inventory-isolated-postgres.mjs'], {
  encoding: 'utf8',
  env: process.env,
  maxBuffer: 4 * 1024 * 1024,
});
if (setup.status !== 0) {
  throw new Error('I3 fixture setup failed: ' + (setup.stderr ?? '').slice(-3000));
}

const SHOP = '20000000-0000-4000-8000-000000000001';
const ACTOR = '30000000-0000-4000-8000-000000000001';
const FOREIGN_ACTOR = '30000000-0000-4000-8000-000000000002';
const ITEM = '50000000-0000-4000-8000-000000000001';
const BUSINESS = '10000000-0000-4000-8000-000000000001';
const REASON_ADJUST = '70000000-0000-4000-8000-000000000001';
const REASON_WASTE = '70000000-0000-4000-8000-000000000002';

// The transfer/stocktake fixture has only the schema needed by those RPCs.
// Add reason snapshot metadata to run the REAL unmodified business logic of
// the patched adjustment and waste RPCs, never fake either movement function.
execute(
  [
    '-c',
    [
      'alter table public.inventory_movements drop constraint if exists inventory_movements_movement_type_check;',
      'alter table public.inventory_movements add column if not exists reason_code_id uuid;',
      'alter table public.inventory_movements add column if not exists reason_code_key text;',
      'alter table public.inventory_movements add column if not exists reason_label_snapshot text;',
      'alter table public.inventory_movements add column if not exists reason_family_snapshot text;',
      'alter table public.inventory_movements add column if not exists reason_config_version bigint;',
      'alter table public.inventory_movements add column if not exists note text;',
      'alter table public.inventory_movements add column if not exists emergency_negative_override boolean not null default false;',
      'create table public.admin_reason_codes (id uuid primary key, business_id uuid not null, shop_id uuid, reason_key text not null, label text not null, family text not null, version bigint not null, active boolean not null);',
      "insert into public.admin_reason_codes values ('" + REASON_ADJUST + "','" + BUSINESS + "',null,'COUNT_CORRECTION','Count correction','STOCK_ADJUSTMENT',1,true), ('" + REASON_WASTE + "','" + BUSINESS + "',null,'SPOILAGE','Spoilage','WASTE',1,true);",
      'create or replace function private.inventory_reason_snapshot_v1(p_business_id uuid,p_shop_id uuid,p_reason_code_id uuid,p_family text) returns table(reason_code_key text,reason_label text,reason_family text,reason_version bigint) language plpgsql security definer set search_path=pg_catalog,public as $snapshot$',
      'begin return query select r.reason_key,r.label,r.family,r.version from public.admin_reason_codes r where r.id=p_reason_code_id and r.business_id=p_business_id and (r.shop_id is null or r.shop_id=p_shop_id) and r.active and r.family=p_family; if not found then raise exception ''inventory_reason_invalid''; end if; end;',
      '$snapshot$;',
    ].join('\n'),
  ],
  'Prepare exact adjustment and waste ledger fixture',
);

execute(
  ['-f', resolve('supabase/migrations/20261027183000_inventory_adjustment_waste_replay_integrity.sql')],
  'Apply I3 replay remediation only to disposable PostgreSQL',
);

function currentBalance() {
  return Number(sql('select on_hand_micros from private.inventory_balance_v1(' +
    literal(SHOP) + ',' + literal(ITEM) + ')'));
}
function movementCount(commandId) {
  return Number(sql('select count(*) from public.inventory_movements where shop_id=' +
    literal(SHOP) + ' and command_id=' + literal(commandId)));
}

const startingBalance = currentBalance();
const adjustArgs = [ACTOR, SHOP, ITEM, 100_000, REASON_ADJUST, 'I3 audit', 'i3-adjust-replay', false];
const adjusted = call('post_inventory_adjustment_v1', ...adjustArgs);
verify(adjusted.ok === true && adjusted.idempotentReplay === false, 'Original adjustment posts once');
equal(currentBalance(), startingBalance + 100_000, 'Adjustment credits exactly 100000 micros');
equal(movementCount('i3-adjust-replay'), 1, 'Original adjustment inserts one durable ledger row');
const adjustmentReplay = call('post_inventory_adjustment_v1', ...adjustArgs);
verify(adjustmentReplay.ok && adjustmentReplay.idempotentReplay, 'Exact adjustment retries idempotently');
equal(adjustmentReplay.movementId, adjusted.movementId, 'Replay preserves original movement ID');
const differentQty = [...adjustArgs];
differentQty[3] = 200_000;
equal(call('post_inventory_adjustment_v1', ...differentQty).code, 'idempotency_conflict',
  'Reused adjustment command with changed quantity denied');
const differentNote = [...adjustArgs];
differentNote[5] = 'changed note';
equal(call('post_inventory_adjustment_v1', ...differentNote).code, 'idempotency_conflict',
  'Reused adjustment command with changed note denied');
const changedOverride = [...adjustArgs];
changedOverride[7] = true;
equal(call('post_inventory_adjustment_v1', ...changedOverride).code, 'idempotency_conflict',
  'Reused adjustment command with changed override denied');
equal(currentBalance(), startingBalance + 100_000, 'Rejected adjustment replays leave ledger balance unchanged');
equal(movementCount('i3-adjust-replay'), 1, 'Changed adjustment payload never adds a second movement');

const crossType = call('post_inventory_waste_v1', ACTOR, SHOP, ITEM, 100_000,
  REASON_WASTE, 'I3 audit', 'i3-adjust-replay', false);
equal(crossType.code, 'idempotency_conflict', 'Adjust ID cannot be reused as Waste ID');
const foreignStatement = 'select public.post_inventory_adjustment_v1(' +
  [FOREIGN_ACTOR, SHOP, ITEM, 100_000, REASON_ADJUST, 'I3 audit', 'i3-adjust-replay', false]
    .map(literal).join(',') + ')';
execute(['-c', foreignStatement], 'Foreign-actor replay must be unauthorized',
  true, 'authority_scope_forbidden');

const wasteArgs = [ACTOR, SHOP, ITEM, 100_000, REASON_WASTE, 'I3 waste', 'i3-waste-replay', false];
const wasted = call('post_inventory_waste_v1', ...wasteArgs);
verify(wasted.ok === true && wasted.idempotentReplay === false, 'Original Waste posts once');
equal(currentBalance(), startingBalance, 'Waste debits exact quantity and restores starting balance');
equal(movementCount('i3-waste-replay'), 1, 'Waste inserts one durable row');
const wasteReplay = call('post_inventory_waste_v1', ...wasteArgs);
verify(wasteReplay.ok && wasteReplay.idempotentReplay, 'Exact Waste retry is idempotent');
equal(wasteReplay.movementId, wasted.movementId, 'Waste replay preserves original movement');
const changedWaste = [...wasteArgs];
changedWaste[3] = 200_000;
equal(call('post_inventory_waste_v1', ...changedWaste).code, 'idempotency_conflict',
  'Changed Waste replay denied');
const oversizedWaste = call('post_inventory_waste_v1', ACTOR, SHOP, ITEM,
  999_999_999_999, REASON_WASTE, 'No override', 'i3-waste-overdraw', false);
equal(oversizedWaste.code, 'insufficient_stock', 'Waste cannot overdraw stock without authorization');
equal(movementCount('i3-waste-overdraw'), 0, 'Rejected Waste has no ledger record');
equal(movementCount('i3-adjust-replay') + movementCount('i3-waste-replay'), 2,
  'One ledger event per accepted Adjust/Waste command ID');
equal(currentBalance(), startingBalance, 'Idempotent and rejected movement attempts do not mutate balance');

console.log('I3 real isolated PostgreSQL: Adjust/Waste replay, changed payload, actor authority, cross-type key, overdraw and exact append-only stock ledger PASS.');
