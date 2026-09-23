import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('Admin order approval PostgreSQL behavior skipped without TEST_DATABASE_URL.');
  process.exit(0);
}
const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Admin order approval PostgreSQL test refuses non-loopback PostgreSQL.');
}

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

function rpc(sql, label) {
  return JSON.parse(psql(['-At', '-c', `select (${sql})::text`], label).trim());
}

psql(
  [
    '-c',
    `drop schema if exists public cascade;
     create schema public;
     drop schema if exists private cascade;
     create schema private;
     drop schema if exists auth cascade;
     create schema auth;
     drop schema if exists storage cascade;
     create schema storage;
     create table storage.buckets (
       id text primary key,
       name text not null unique,
       public boolean not null default false
     );
     do $$
     begin
       if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon noinherit; end if;
       if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated noinherit; end if;
       if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role noinherit; end if;
     end $$;
     grant usage on schema public to anon, authenticated, service_role;
     create table auth.users(id uuid primary key);
     create function auth.uid() returns uuid language sql stable as $$
       select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
     $$;`,
  ],
  'Order approval fixture reset',
);

const migrationName = '20260910160000_admin_order_controls.sql';
const migrationsDirectory = resolve('supabase/migrations');
const migrations = readdirSync(migrationsDirectory)
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort();
const targetIndex = migrations.indexOf(migrationName);
if (targetIndex < 0) throw new Error('Admin order controls migration missing from repository chain.');
for (const migration of migrations.slice(0, targetIndex + 1)) {
  psql(['-f', resolve(migrationsDirectory, migration)], migration);
}

const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
const SHOP_ID = '51000000-0000-4000-8000-000000000001';
const REQUESTER_ID = '52000000-0000-4000-8000-000000000001';
const APPROVER_ID = '52000000-0000-4000-8000-000000000002';
const WORKER_ID = '53000000-0000-4000-8000-000000000001';
const DAY_ID = '54000000-0000-4000-8000-000000000001';
const CATEGORY_ID = '55000000-0000-4000-8000-000000000001';
const PRODUCT_ID = '56000000-0000-4000-8000-000000000001';
const ORDER_TYPE_ID = '57000000-0000-4000-8000-000000000001';
const PAYMENT_METHOD_ID = '58000000-0000-4000-8000-000000000001';
const ORDER_ID = '59000000-0000-4000-8000-000000000001';
const ITEM_ID = '5a000000-0000-4000-8000-000000000001';
const PAYMENT_ID = '5b000000-0000-4000-8000-000000000001';
const REASON_ID = '5c000000-0000-4000-8000-000000000001';
const RULE_ID = '5d000000-0000-4000-8000-000000000001';
const RETURN_RULE_ID = '5d000000-0000-4000-8000-000000000002';

psql(
  [
    '-c',
    `insert into public.shops(id, name, active)
       values ('${SHOP_ID}', 'Order Approval Test Shop', true);
     insert into public.business_shops(business_id, shop_id)
       values ('${BUSINESS_ID}', '${SHOP_ID}');
     insert into public.business_employees(id, business_id, display_name, role, active)
       values
         ('${REQUESTER_ID}', '${BUSINESS_ID}', 'Refund Requester', 'OWNER', true),
         ('${APPROVER_ID}', '${BUSINESS_ID}', 'Refund Approver', 'OWNER', true);
     insert into public.workers(id, shop_id, display_name, pin_hash, active)
       values ('${WORKER_ID}', '${SHOP_ID}', 'Order Worker', 'test-only', true);
     insert into public.business_days(
       id, shop_id, status, started_at, ended_at, started_by_worker_id,
       ended_by_worker_id, last_allocated_display_order_no
     ) values (
       '${DAY_ID}', '${SHOP_ID}', 'OPEN', '2026-09-23T05:00:00Z',
       null, '${WORKER_ID}', null, 1
     );
     insert into public.menu_categories(id, shop_id, name, sort_order, active)
       values ('${CATEGORY_ID}', '${SHOP_ID}', 'Food', 0, true);
     insert into public.products(
       id, shop_id, category_id, name, price_minor, active, sold_out, is_combo, sort_order
     ) values (
       '${PRODUCT_ID}', '${SHOP_ID}', '${CATEGORY_ID}', 'Approval Burger',
       5000, true, false, false, 0
     );
     insert into public.order_types(id, shop_id, name, behavior, active, sort_order)
       values ('${ORDER_TYPE_ID}', '${SHOP_ID}', 'Take Away', 'TAKE_AWAY', true, 0);
     insert into public.payment_methods(
       id, shop_id, display_name, logic_type, requires_reconciliation, active, sort_order
     ) values (
       '${PAYMENT_METHOD_ID}', '${SHOP_ID}', 'Card', 'CARD', true, true, 0
     );
     insert into public.orders(
       id, shop_id, business_day_id, display_order_no, idempotency_key, source, status,
       operator_worker_id, operator_name_snapshot, order_type_id, order_type_label_snapshot,
       order_type_behavior_snapshot, customer_contact_id, customer_name_snapshot,
       normalized_phone_snapshot, address_snapshot, delivery_zone_id,
       delivery_zone_label_snapshot, configured_delivery_fee_minor, final_delivery_fee_minor,
       items_subtotal_minor, discount_minor, total_minor, order_note, created_at, updated_at
     ) values (
       '${ORDER_ID}', '${SHOP_ID}', '${DAY_ID}', 1, 'approval-order-1', 'POS', 'DONE',
       '${WORKER_ID}', 'Order Worker', '${ORDER_TYPE_ID}', 'Take Away',
       'TAKE_AWAY', null, null, null, null, null, null, 0, 0,
       20000, 0, 20000, null, '2026-09-23T05:10:00Z', '2026-09-23T05:10:00Z'
     );
     insert into public.order_items(
       id, shop_id, order_id, product_id, product_name_snapshot,
       unit_price_minor, quantity, item_note, line_position
     ) values (
       '${ITEM_ID}', '${SHOP_ID}', '${ORDER_ID}', '${PRODUCT_ID}',
       'Approval Burger', 5000, 4, null, 0
     );
     insert into public.payments(
       id, shop_id, order_id, part_index, payment_method_id,
       payment_method_label_snapshot, logic_type_snapshot, allocated_minor,
       received_minor, change_minor, created_at
     ) values (
       '${PAYMENT_ID}', '${SHOP_ID}', '${ORDER_ID}', 1, '${PAYMENT_METHOD_ID}',
       'Card', 'CARD', 20000, null, null, '2026-09-23T05:10:00Z'
     );
     insert into public.admin_reason_codes(
       id, business_id, shop_id, reason_key, family, label, active,
       version, updated_by_employee_id
     ) values (
       '${REASON_ID}', '${BUSINESS_ID}', null, 'CUSTOMER_REQUEST',
       'REFUND_RETURN', 'Customer request', true, 3, '${REQUESTER_ID}'
     );
     insert into public.admin_approval_rules(
       id, business_id, shop_id, action_type, requester_permission,
       approver_permission, requires_second_person, threshold_context, active
     ) values
       (
         '${RULE_ID}', '${BUSINESS_ID}', '${SHOP_ID}', 'ORDER_REFUND',
         'orders.refund', 'approvals.review', true, '{"minimumMinor":5000}'::jsonb, true
       ),
       (
         '${RETURN_RULE_ID}', '${BUSINESS_ID}', '${SHOP_ID}', 'ORDER_RETURN',
         'orders.refund', 'approvals.review', true,
         '{"minimumQuantityImpact":2}'::jsonb, true
       );`,
  ],
  'Order approval fixture seed',
);

const belowThreshold = rpc(
  `public.request_admin_order_refund_v1(
    '${REQUESTER_ID}', '${SHOP_ID}', '${ORDER_ID}', '${PAYMENT_ID}',
    1000, '${REASON_ID}', 'Below threshold', 'refund-direct-1', '${BUSINESS_ID}'
  )`,
  'Below-threshold refund',
);
if (
  belowThreshold.ok !== true ||
  belowThreshold.state !== 'POSTED' ||
  belowThreshold.replayed !== false
) {
  throw new Error(`below-threshold refund should post directly: ${JSON.stringify(belowThreshold)}`);
}

const directReplay = rpc(
  `public.request_admin_order_refund_v1(
    '${REQUESTER_ID}', '${SHOP_ID}', '${ORDER_ID}', '${PAYMENT_ID}',
    1000, '${REASON_ID}', 'Below threshold', 'refund-direct-1', '${BUSINESS_ID}'
  )`,
  'Below-threshold refund replay',
);
if (
  directReplay.ok !== true ||
  directReplay.state !== 'POSTED' ||
  directReplay.replayed !== true ||
  directReplay.refundId !== belowThreshold.refundId
) {
  throw new Error(`direct refund replay changed result: ${JSON.stringify(directReplay)}`);
}

const directConflict = rpc(
  `public.request_admin_order_refund_v1(
    '${REQUESTER_ID}', '${SHOP_ID}', '${ORDER_ID}', '${PAYMENT_ID}',
    999, '${REASON_ID}', 'Below threshold', 'refund-direct-1', '${BUSINESS_ID}'
  )`,
  'Below-threshold refund command conflict',
);
if (directConflict.ok !== false || directConflict.code !== 'command_id_conflict') {
  throw new Error(`changed command payload should conflict: ${JSON.stringify(directConflict)}`);
}

const heldRefund = rpc(
  `public.request_admin_order_refund_v1(
    '${REQUESTER_ID}', '${SHOP_ID}', '${ORDER_ID}', '${PAYMENT_ID}',
    5000, '${REASON_ID}', 'Needs approval', 'refund-held-1', '${BUSINESS_ID}'
  )`,
  'Above-threshold refund',
);
if (
  heldRefund.ok !== true ||
  heldRefund.state !== 'PENDING_APPROVAL' ||
  typeof heldRefund.approvalRequestId !== 'string'
) {
  throw new Error(`above-threshold refund should be held: ${JSON.stringify(heldRefund)}`);
}

const heldRow = JSON.parse(
  psql(
    [
      '-At',
      '-c',
      `select jsonb_build_object(
         'state', r.state,
         'approvalRequestId', r.approval_request_id,
         'reasonKey', r.reason_code_key,
         'reasonLabel', r.reason_label_snapshot,
         'reasonFamily', r.reason_family_snapshot,
         'reasonVersion', r.reason_config_version,
         'approvalStatus', a.status
       )::text
       from public.admin_order_refunds r
       join public.admin_approval_requests a on a.id = r.approval_request_id
       where r.id = '${heldRefund.refundId}'::uuid`,
    ],
    'Held refund snapshot readback',
  ).trim(),
);
if (
  heldRow.state !== 'PENDING_APPROVAL' ||
  heldRow.approvalStatus !== 'PENDING' ||
  heldRow.reasonKey !== 'CUSTOMER_REQUEST' ||
  heldRow.reasonLabel !== 'Customer request' ||
  heldRow.reasonFamily !== 'REFUND_RETURN' ||
  Number(heldRow.reasonVersion) !== 3
) {
  throw new Error(`held refund snapshot is invalid: ${JSON.stringify(heldRow)}`);
}


const heldRefundReplay = rpc(
  `public.request_admin_order_refund_v1(
    '${REQUESTER_ID}', '${SHOP_ID}', '${ORDER_ID}', '${PAYMENT_ID}',
    5000, '${REASON_ID}', 'Needs approval', 'refund-held-1', '${BUSINESS_ID}'
  )`,
  'Above-threshold refund replay',
);
if (
  heldRefundReplay.ok !== true ||
  heldRefundReplay.state !== 'PENDING_APPROVAL' ||
  heldRefundReplay.replayed !== true ||
  heldRefundReplay.refundId !== heldRefund.refundId ||
  heldRefundReplay.approvalRequestId !== heldRefund.approvalRequestId
) {
  throw new Error(`held refund replay changed result: ${JSON.stringify(heldRefundReplay)}`);
}

const selfApproval = rpc(
  `public.decide_admin_approval_request_v1(
    '${heldRefund.approvalRequestId}'::uuid,
    '${REQUESTER_ID}'::uuid,
    null,
    'APPROVE',
    'self approval attempt'
  )`,
  'Refund self approval attempt',
);
if (selfApproval.ok !== false || selfApproval.code !== 'self_approval_forbidden') {
  throw new Error(`requester bypassed second-person approval: ${JSON.stringify(selfApproval)}`);
}

const approvedRefund = rpc(
  `public.decide_admin_approval_request_v1(
    '${heldRefund.approvalRequestId}'::uuid,
    '${APPROVER_ID}'::uuid,
    null,
    'APPROVE',
    'approved by second employee'
  )`,
  'Refund approval decision',
);
if (approvedRefund.ok !== true || approvedRefund.status !== 'APPROVED') {
  throw new Error(`refund approval failed: ${JSON.stringify(approvedRefund)}`);
}

const refundClaimOutput = psql(
  [
    '-At',
    '-c',
    `select to_jsonb(claim)::text
     from public.claim_admin_approval_execution_v1(
       'plan5-order-approval-test',
       now(),
       25,
       300
     ) claim
     where claim.approval_request_id = '${heldRefund.approvalRequestId}'::uuid`,
  ],
  'Refund approval execution claim',
).trim();
if (!refundClaimOutput) throw new Error('approved refund did not produce an execution claim');
const refundClaim = JSON.parse(refundClaimOutput);

const postedRefund = rpc(
  `public.execute_approved_admin_order_refund_v1(
    '${heldRefund.approvalRequestId}'::uuid,
    '${BUSINESS_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    '${REQUESTER_ID}'::uuid,
    '${APPROVER_ID}'::uuid,
    '${ORDER_ID}'::uuid,
    '${PAYMENT_ID}'::uuid,
    5000,
    '${REASON_ID}'::uuid,
    'Needs approval',
    'refund-held-1'
  )`,
  'Execute approved refund',
);
if (postedRefund.ok !== true || postedRefund.state !== 'POSTED' || postedRefund.replayed !== false) {
  throw new Error(`approved refund did not post: ${JSON.stringify(postedRefund)}`);
}

const postedRefundReplay = rpc(
  `public.execute_approved_admin_order_refund_v1(
    '${heldRefund.approvalRequestId}'::uuid,
    '${BUSINESS_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    '${REQUESTER_ID}'::uuid,
    '${APPROVER_ID}'::uuid,
    '${ORDER_ID}'::uuid,
    '${PAYMENT_ID}'::uuid,
    5000,
    '${REASON_ID}'::uuid,
    'Needs approval',
    'refund-held-1'
  )`,
  'Execute approved refund replay',
);
if (
  postedRefundReplay.ok !== true ||
  postedRefundReplay.state !== 'POSTED' ||
  postedRefundReplay.replayed !== true ||
  postedRefundReplay.refundId !== postedRefund.refundId
) {
  throw new Error(`approved refund execution was not idempotent: ${JSON.stringify(postedRefundReplay)}`);
}

const completeRefund = rpc(
  `public.complete_admin_approval_execution_v1(
    '${heldRefund.approvalRequestId}'::uuid,
    '${refundClaim.claim_token}',
    'EXECUTED',
    null,
    jsonb_build_object('refundId', '${postedRefund.refundId}'),
    now()
  )`,
  'Complete refund approval execution',
);
if (completeRefund.ok !== true || completeRefund.status !== 'EXECUTED') {
  throw new Error(`refund approval completion failed: ${JSON.stringify(completeRefund)}`);
}

const rejectedRefund = rpc(
  `public.request_admin_order_refund_v1(
    '${REQUESTER_ID}', '${SHOP_ID}', '${ORDER_ID}', '${PAYMENT_ID}',
    5000, '${REASON_ID}', 'Reject this refund', 'refund-rejected-1', '${BUSINESS_ID}'
  )`,
  'Refund awaiting rejection',
);
if (rejectedRefund.ok !== true || rejectedRefund.state !== 'PENDING_APPROVAL') {
  throw new Error(`rejected-refund fixture was not held: ${JSON.stringify(rejectedRefund)}`);
}
const rejectDecision = rpc(
  `public.decide_admin_approval_request_v1(
    '${rejectedRefund.approvalRequestId}'::uuid,
    '${APPROVER_ID}'::uuid,
    null,
    'REJECT',
    'refund rejected'
  )`,
  'Reject refund approval',
);
if (rejectDecision.ok !== true || rejectDecision.status !== 'REJECTED') {
  throw new Error(`refund rejection failed: ${JSON.stringify(rejectDecision)}`);
}
const rejectedRefundState = psql(
  [
    '-At',
    '-c',
    `select state from public.admin_order_refunds where id = '${rejectedRefund.refundId}'::uuid`,
  ],
  'Rejected refund state',
).trim();
if (rejectedRefundState !== 'PENDING_APPROVAL') {
  throw new Error(`rejected refund unexpectedly posted: ${rejectedRefundState}`);
}

const directReturn = rpc(
  `public.return_admin_order_items_v1(
    '${REQUESTER_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    '${ORDER_ID}'::uuid,
    jsonb_build_array(jsonb_build_object('orderItemId', '${ITEM_ID}', 'quantity', 1)),
    '${REASON_ID}'::uuid,
    'Below return threshold',
    'return-direct-1',
    '${BUSINESS_ID}'::uuid
  )`,
  'Below-threshold return',
);
if (directReturn.ok !== true || directReturn.state !== 'POSTED' || directReturn.replayed !== false) {
  throw new Error(`below-threshold return should post directly: ${JSON.stringify(directReturn)}`);
}

const heldReturn = rpc(
  `public.return_admin_order_items_v1(
    '${REQUESTER_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    '${ORDER_ID}'::uuid,
    jsonb_build_array(jsonb_build_object('orderItemId', '${ITEM_ID}', 'quantity', 2)),
    '${REASON_ID}'::uuid,
    'Needs return approval',
    'return-held-1',
    '${BUSINESS_ID}'::uuid
  )`,
  'Above-threshold return',
);
if (
  heldReturn.ok !== true ||
  heldReturn.state !== 'PENDING_APPROVAL' ||
  typeof heldReturn.approvalRequestId !== 'string'
) {
  throw new Error(`above-threshold return should be held: ${JSON.stringify(heldReturn)}`);
}

const approvedReturn = rpc(
  `public.decide_admin_approval_request_v1(
    '${heldReturn.approvalRequestId}'::uuid,
    '${APPROVER_ID}'::uuid,
    null,
    'APPROVE',
    'return approved'
  )`,
  'Return approval decision',
);
if (approvedReturn.ok !== true || approvedReturn.status !== 'APPROVED') {
  throw new Error(`return approval failed: ${JSON.stringify(approvedReturn)}`);
}

const returnClaimOutput = psql(
  [
    '-At',
    '-c',
    `select to_jsonb(claim)::text
     from public.claim_admin_approval_execution_v1(
       'plan5-order-return-approval-test',
       now(),
       25,
       300
     ) claim
     where claim.approval_request_id = '${heldReturn.approvalRequestId}'::uuid`,
  ],
  'Return approval execution claim',
).trim();
if (!returnClaimOutput) throw new Error('approved return did not produce an execution claim');

const postedReturn = rpc(
  `public.execute_approved_admin_order_return_v1(
    '${heldReturn.approvalRequestId}'::uuid,
    '${BUSINESS_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    '${REQUESTER_ID}'::uuid,
    '${APPROVER_ID}'::uuid,
    '${ORDER_ID}'::uuid,
    jsonb_build_array(jsonb_build_object('orderItemId', '${ITEM_ID}', 'quantity', 2)),
    '${REASON_ID}'::uuid,
    'Needs return approval',
    'return-held-1'
  )`,
  'Execute approved return',
);
if (postedReturn.ok !== true || postedReturn.state !== 'POSTED' || postedReturn.replayed !== false) {
  throw new Error(`approved return did not post: ${JSON.stringify(postedReturn)}`);
}

const postedReturnReplay = rpc(
  `public.execute_approved_admin_order_return_v1(
    '${heldReturn.approvalRequestId}'::uuid,
    '${BUSINESS_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    '${REQUESTER_ID}'::uuid,
    '${APPROVER_ID}'::uuid,
    '${ORDER_ID}'::uuid,
    jsonb_build_array(jsonb_build_object('orderItemId', '${ITEM_ID}', 'quantity', 2)),
    '${REASON_ID}'::uuid,
    'Needs return approval',
    'return-held-1'
  )`,
  'Execute approved return replay',
);
if (
  postedReturnReplay.ok !== true ||
  postedReturnReplay.state !== 'POSTED' ||
  postedReturnReplay.replayed !== true ||
  postedReturnReplay.returnId !== postedReturn.returnId
) {
  throw new Error(`approved return execution was not idempotent: ${JSON.stringify(postedReturnReplay)}`);
}

console.log('Admin order approval PostgreSQL threshold behavior passed.');
