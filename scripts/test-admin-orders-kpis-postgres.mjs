import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for Orders O2 acceptance');
const dbHost = new URL(databaseUrl).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(dbHost)) {
  throw new Error('Orders KPI fixture must run only against isolated loopback PostgreSQL');
}

function run(sql, label) {
  const result = spawnSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    throw new Error(`${label} failed (exit ${result.status ?? 'unknown'})`);
  }
  return result.stdout.trim();
}
function queryJson(sql, label) {
  return JSON.parse(run(`select (${sql})::text`, label));
}
const SHOP = '51000000-0000-4000-8000-000000000001';
const DAY = '54000000-0000-4000-8000-000000000001';
const BUSINESS = '00000000-0000-4000-8000-000000000001';
const ACTOR = '52000000-0000-4000-8000-000000000001';
const WORKER = '53000000-0000-4000-8000-000000000001';
const METHOD = '58000000-0000-4000-8000-000000000001';
const TYPE = '57000000-0000-4000-8000-000000000001';

const migration = spawnSync(
  'psql',
  [
    databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-f',
    resolve('supabase/migrations/20261026000000_orders_authoritative_kpis.sql'),
  ],
  { encoding: 'utf8' },
);
if (migration.status !== 0) {
  process.stderr.write(migration.stdout ?? '');
  process.stderr.write(migration.stderr ?? '');
  throw new Error('Orders KPI migration failed on isolated PostgreSQL');
}

const privileges = queryJson(`jsonb_build_object(
  'anonymous', has_function_privilege('anon', 'public.admin_orders_kpis_v1(uuid,uuid,timestamptz,timestamptz)', 'EXECUTE'),
  'authenticated', has_function_privilege('authenticated', 'public.admin_orders_kpis_v1(uuid,uuid,timestamptz,timestamptz)', 'EXECUTE'),
  'service', has_function_privilege('service_role', 'public.admin_orders_kpis_v1(uuid,uuid,timestamptz,timestamptz)', 'EXECUTE')
)`, 'RPC execution grants');
if (privileges.anonymous || privileges.authenticated || !privileges.service) {
  throw new Error(`Orders KPI RPC permission exposure: ${JSON.stringify(privileges)}`);
}

run(`insert into public.orders(
  id, shop_id, business_day_id, display_order_no, idempotency_key, source, status,
  operator_worker_id, operator_name_snapshot, order_type_id, order_type_label_snapshot,
  order_type_behavior_snapshot, configured_delivery_fee_minor, final_delivery_fee_minor,
  items_subtotal_minor, discount_minor, total_minor, order_note, created_at, updated_at
)
select md5('kpi-fixture-order-' || g)::uuid, '${SHOP}', '${DAY}', 1000+g, 'kpi-fixture-' || g,
  case when g%2=0 then 'POS' else 'ONLINE' end,
  case when g%4=0 then 'ACTIVE' else 'DONE' end,
  '${WORKER}', 'Fixture worker', '${TYPE}', 'Take Away',
  'TAKE_AWAY', 0, 0, 1000, 0, 1000, null,
  '2026-09-23T05:10:00Z'::timestamptz + g*interval '1 minute',
  '2026-09-23T05:10:00Z'::timestamptz + g*interval '1 minute'
from generate_series(1,64) g;

insert into public.payments(
  id,shop_id,order_id,part_index,payment_method_id,payment_method_label_snapshot,
  logic_type_snapshot,allocated_minor,received_minor,change_minor,created_at
)
select md5('kpi-fixture-payment-'||g||'-1')::uuid, '${SHOP}',
  md5('kpi-fixture-order-'||g)::uuid, 1, '${METHOD}', 'Card', 'CARD',
  case when g%8=1 then 600 else 1000 end, null, null,
  '2026-09-23T05:10:00Z'::timestamptz + g*interval '1 minute'
from generate_series(1,64) g where g%8<>0;

insert into public.payments(
  id,shop_id,order_id,part_index,payment_method_id,payment_method_label_snapshot,
  logic_type_snapshot,allocated_minor,received_minor,change_minor,created_at
)
select md5('kpi-fixture-payment-'||g||'-2')::uuid, '${SHOP}',
  md5('kpi-fixture-order-'||g)::uuid, 2, '${METHOD}', 'Card', 'CARD',
  400, null, null, '2026-09-23T05:10:00Z'::timestamptz + g*interval '1 minute'
from generate_series(1,64) g where g%8=1;`, 'Insert 64 mixed POS/ONLINE canonical orders with split payments');

const kpis = (from='null', to='null', actor=ACTOR, shop=SHOP) =>
  queryJson(`public.admin_orders_kpis_v1('${actor}'::uuid,'${shop}'::uuid,
    ${from}::timestamptz,${to}::timestamptz)`, 'Authoritative Orders KPI RPC');

const full = kpis();
if (full.ok !== true || full.shopId !== SHOP || Number(full.orderCount) < 67) {
  throw new Error(`Aggregate excluded canonical orders beyond cursor 50: ${JSON.stringify(full)}`);
}
const expected = queryJson(`jsonb_build_object(
    'allOrders', (select count(*) from public.orders where shop_id='${SHOP}'),
    'activeOrders', (select count(*) from public.orders
      where shop_id='${SHOP}' and status='ACTIVE'),
    'paidOrders', (select count(distinct p.order_id) from public.payments p
      where p.shop_id='${SHOP}' and p.allocated_minor>0),
    'allocated', (select coalesce(sum(allocated_minor),0) from public.payments
      where shop_id='${SHOP}'),
    'refunds', (select coalesce(sum(amount_minor),0) from public.admin_order_refunds
      where business_id='${BUSINESS}' and shop_id='${SHOP}' and state='POSTED')
)`, 'Independent expected PostgreSQL ledger facts');
const amount = Number(expected.allocated) - Number(expected.refunds);
const average = expected.paidOrders ? Math.round(amount / Number(expected.paidOrders)) : null;
if (
  full.orderCount !== Number(expected.allOrders) ||
  full.activeOrderCount !== Number(expected.activeOrders) ||
  full.netSalesMinor !== amount ||
  full.averageOrderMinor !== average ||
  full.denominatorPaidOrderCount !== Number(expected.paidOrders)
) {
  throw new Error(`Full-shop financial/cursor mismatch: ${JSON.stringify({ full, expected, amount, average })}`);
}
const timed = kpis("'2026-09-23T05:10:30Z'", "'2026-09-23T05:18:30Z'");
if (timed.ok !== true || timed.orderCount !== 8) {
  throw new Error(`UTC instant filter mismatch (Cairo UI conversion): ${JSON.stringify(timed)}`);
}
const emptyPeriod = kpis("'2026-01-01T00:00:00Z'", "'2026-01-02T00:00:00Z'");
if (emptyPeriod.ok !== true || emptyPeriod.orderCount !== 0 ||
    emptyPeriod.netSalesMinor !== 0 || emptyPeriod.averageOrderMinor !== null ||
    emptyPeriod.denominatorPaidOrderCount !== 0) {
  throw new Error(`Zero-denominator contract failure: ${JSON.stringify(emptyPeriod)}`);
}
for (const result of [
  kpis('null','null','66000000-0000-4000-8000-000000000001'),
  kpis('null','null',ACTOR,'67000000-0000-4000-8000-000000000001'),
]) {
  if (result.ok !== false || result.code !== 'permission_forbidden') {
    throw new Error(`Unassigned actor or foreign shop exposed totals: ${JSON.stringify(result)}`);
  }
}
const reversed = kpis("'2026-09-25T00:00:00Z'", "'2026-09-23T00:00:00Z'");
if (reversed.ok !== false || reversed.code !== 'orders_kpi_range_invalid') {
  throw new Error(`Invalid range returned metrics: ${JSON.stringify(reversed)}`);
}
console.log(JSON.stringify({
  test: 'Orders O2 real PostgreSQL shop-wide, split payment, posted refund and access acceptance',
  result: 'PASS',
  orders: full.orderCount,
  active: full.activeOrderCount,
  netSalesMinor: full.netSalesMinor,
  averageOrderMinor: full.averageOrderMinor,
  paidDenominator: full.denominatorPaidOrderCount,
  filteredOrders: timed.orderCount,
  privilegeCheck: privileges,
}));
