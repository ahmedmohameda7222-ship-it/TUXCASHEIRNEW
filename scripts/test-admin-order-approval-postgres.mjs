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
if (targetIndex < 0)
  throw new Error('Admin order controls migration missing from repository chain.');
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
const MODIFIER_ID = '56500000-0000-4000-8000-000000000001';
const ORDER_ITEM_MODIFIER_ID = '56500000-0000-4000-8000-000000000002';
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
     insert into public.modifiers(id, shop_id, name, price_minor, active, sort_order)
       values ('${MODIFIER_ID}', '${SHOP_ID}', 'Extra cheese', 500, true, 0);
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
       22000, 0, 22000, null, '2026-09-23T05:10:00Z', '2026-09-23T05:10:00Z'
     );
     insert into public.order_items(
       id, shop_id, order_id, product_id, product_name_snapshot,
       unit_price_minor, quantity, item_note, line_position
     ) values (
       '${ITEM_ID}', '${SHOP_ID}', '${ORDER_ID}', '${PRODUCT_ID}',
       'Approval Burger', 5000, 4, null, 0
     );
     insert into public.order_item_modifiers(
       id, shop_id, order_item_id, modifier_id, modifier_label_snapshot,
       unit_price_minor, quantity, position
     ) values (
       '${ORDER_ITEM_MODIFIER_ID}', '${SHOP_ID}', '${ITEM_ID}', '${MODIFIER_ID}',
       'Extra cheese', 500, 1, 0
     );
     insert into public.payments(
       id, shop_id, order_id, part_index, payment_method_id,
       payment_method_label_snapshot, logic_type_snapshot, allocated_minor,
       received_minor, change_minor, created_at
     ) values (
       '${PAYMENT_ID}', '${SHOP_ID}', '${ORDER_ID}', 1, '${PAYMENT_METHOD_ID}',
       'Card', 'CARD', 22000, null, null, '2026-09-23T05:10:00Z'
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
if (
  postedRefund.ok !== true ||
  postedRefund.state !== 'POSTED' ||
  postedRefund.replayed !== false
) {
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
  throw new Error(
    `approved refund execution was not idempotent: ${JSON.stringify(postedRefundReplay)}`,
  );
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
if (
  directReturn.ok !== true ||
  directReturn.state !== 'POSTED' ||
  directReturn.replayed !== false
) {
  throw new Error(`below-threshold return should post directly: ${JSON.stringify(directReturn)}`);
}

const directReturnReplay = rpc(
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
  'Below-threshold return replay',
);
if (
  directReturnReplay.ok !== true ||
  directReturnReplay.state !== 'POSTED' ||
  directReturnReplay.replayed !== true ||
  directReturnReplay.returnId !== directReturn.returnId
) {
  throw new Error(`direct return replay changed result: ${JSON.stringify(directReturnReplay)}`);
}

const directReturnConflict = rpc(
  `public.return_admin_order_items_v1(
    '${REQUESTER_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    '${ORDER_ID}'::uuid,
    jsonb_build_array(jsonb_build_object('orderItemId', '${ITEM_ID}', 'quantity', 1)),
    '${REASON_ID}'::uuid,
    'Changed payload',
    'return-direct-1',
    '${BUSINESS_ID}'::uuid
  )`,
  'Return command conflict',
);
if (directReturnConflict.ok !== false || directReturnConflict.code !== 'command_id_conflict') {
  throw new Error(
    `changed return payload should conflict: ${JSON.stringify(directReturnConflict)}`,
  );
}

const rejectedReturn = rpc(
  `public.return_admin_order_items_v1(
    '${REQUESTER_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    '${ORDER_ID}'::uuid,
    jsonb_build_array(jsonb_build_object('orderItemId', '${ITEM_ID}', 'quantity', 2)),
    '${REASON_ID}'::uuid,
    'Reject this return',
    'return-rejected-1',
    '${BUSINESS_ID}'::uuid
  )`,
  'Return requiring rejection',
);
if (
  rejectedReturn.ok !== true ||
  rejectedReturn.state !== 'PENDING_APPROVAL' ||
  typeof rejectedReturn.approvalRequestId !== 'string'
) {
  throw new Error(
    `return requiring approval should be held before rejection: ${JSON.stringify(rejectedReturn)}`,
  );
}

const rejectedReturnDecision = rpc(
  `public.decide_admin_approval_request_v1(
    '${rejectedReturn.approvalRequestId}'::uuid,
    '${APPROVER_ID}'::uuid,
    null,
    'REJECT',
    'return rejected'
  )`,
  'Return rejection decision',
);
if (rejectedReturnDecision.ok !== true || rejectedReturnDecision.status !== 'REJECTED') {
  throw new Error(`return rejection failed: ${JSON.stringify(rejectedReturnDecision)}`);
}

const rejectedReturnState = JSON.parse(
  psql(
    [
      '-At',
      '-c',
      `select jsonb_build_object(
         'returnState', r.state,
         'approvalStatus', a.status
       )::text
       from public.admin_order_returns r
       join public.admin_approval_requests a on a.id = r.approval_request_id
       where r.id = '${rejectedReturn.returnId}'::uuid`,
    ],
    'Rejected return state readback',
  ).trim(),
);
if (
  rejectedReturnState.returnState !== 'PENDING_APPROVAL' ||
  rejectedReturnState.approvalStatus !== 'REJECTED'
) {
  throw new Error(`rejected return posted unexpectedly: ${JSON.stringify(rejectedReturnState)}`);
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

const heldReturnReplay = rpc(
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
  'Above-threshold return replay',
);
if (
  heldReturnReplay.ok !== true ||
  heldReturnReplay.state !== 'PENDING_APPROVAL' ||
  heldReturnReplay.replayed !== true ||
  heldReturnReplay.returnId !== heldReturn.returnId ||
  heldReturnReplay.approvalRequestId !== heldReturn.approvalRequestId
) {
  throw new Error(`held return replay changed result: ${JSON.stringify(heldReturnReplay)}`);
}

const returnSelfApproval = rpc(
  `public.decide_admin_approval_request_v1(
    '${heldReturn.approvalRequestId}'::uuid,
    '${REQUESTER_ID}'::uuid,
    null,
    'APPROVE',
    'self approval attempt'
  )`,
  'Return self approval attempt',
);
if (returnSelfApproval.ok !== false || returnSelfApproval.code !== 'self_approval_forbidden') {
  throw new Error(
    `requester bypassed return second-person approval: ${JSON.stringify(returnSelfApproval)}`,
  );
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
if (
  postedReturn.ok !== true ||
  postedReturn.state !== 'POSTED' ||
  postedReturn.replayed !== false
) {
  throw new Error(`approved return did not post: ${JSON.stringify(postedReturn)}`);
}

const returnedItemAmount = Number(
  psql(
    [
      '-At',
      '-c',
      `select amount_minor
       from public.admin_order_return_items
       where return_id = '${postedReturn.returnId}'::uuid
         and order_item_id = '${ITEM_ID}'::uuid`,
    ],
    'Returned item modifier-inclusive amount',
  ).trim(),
);
if (returnedItemAmount !== 11000) {
  throw new Error(`returned item amount omitted immutable modifier charges: ${returnedItemAmount}`);
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
  throw new Error(
    `approved return execution was not idempotent: ${JSON.stringify(postedReturnReplay)}`,
  );
}

console.log('Admin order approval PostgreSQL threshold behavior passed.');

/* Orders P1 regression: unsafe paid Admin cancellation must roll back fully,
   while the existing unpaid path remains functional and command-replay safe. */
psql(
  ['-f', resolve(migrationsDirectory, '20261025150000_orders_paid_cancel_safety.sql')],
  'Apply isolated paid-Active cancellation guard',
);

const PAID_ACTIVE_ID = '59000000-0000-4000-8000-000000000092';
const UNPAID_ACTIVE_ID = '59000000-0000-4000-8000-000000000093';
const PAID_PAYMENT_ID = '5b000000-0000-4000-8000-000000000092';
const CANCEL_REASON_ID = '5c000000-0000-4000-8000-000000000092';

psql(
  [
    '-c',
    `update public.business_days
       set last_allocated_display_order_no = 3 where id = '${DAY_ID}';
     insert into public.orders(
       id, shop_id, business_day_id, display_order_no, idempotency_key,
       source, status, operator_worker_id, operator_name_snapshot,
       order_type_id, order_type_label_snapshot, order_type_behavior_snapshot,
       items_subtotal_minor, discount_minor, total_minor, order_note, created_at, updated_at
     ) values
       ('${PAID_ACTIVE_ID}', '${SHOP_ID}', '${DAY_ID}', 2, 'paid-active-test',
        'POS', 'ACTIVE', '${WORKER_ID}', 'Test worker', '${ORDER_TYPE_ID}',
        'Take Away', 'TAKE_AWAY', 11000, 0, 11000, null, now(), now()),
       ('${UNPAID_ACTIVE_ID}', '${SHOP_ID}', '${DAY_ID}', 3, 'unpaid-active-test',
        'POS', 'ACTIVE', '${WORKER_ID}', 'Test worker', '${ORDER_TYPE_ID}',
        'Take Away', 'TAKE_AWAY', 11000, 0, 11000, null, now(), now());
     insert into public.payments(
       id, shop_id, order_id, part_index, payment_method_id,
       payment_method_label_snapshot, logic_type_snapshot,
       allocated_minor, received_minor, change_minor, created_at
     ) values (
       '${PAID_PAYMENT_ID}', '${SHOP_ID}', '${PAID_ACTIVE_ID}',
       1, '${PAYMENT_METHOD_ID}', 'Card', 'CARD', 5000, null, null, now()
     );
     insert into public.admin_reason_codes(
       id, business_id, shop_id, reason_key, family, label,
       active, version, updated_by_employee_id
     ) values (
       '${CANCEL_REASON_ID}', '${BUSINESS_ID}', null,
       'CUSTOMER_CHANGED_MIND', 'CANCELLATION', 'Customer changed mind',
       true, 1, '${REQUESTER_ID}'
     );`,
  ],
  'Seed paid and unpaid ACTIVE cancellation cases',
);

// The Admin cancel RPC releases inventory reservations before setting order status.
// Seed real reservation movements: a guard exception must unwind all preceding writes.
const RESERVED_ITEM_ID = '60000000-0000-4000-8000-000000000092';
const PAID_RESERVATION_ID = '61000000-0000-4000-8000-000000000092';
const UNPAID_RESERVATION_ID = '61000000-0000-4000-8000-000000000093';

psql(
  [
    '-c',
    `insert into public.inventory_items(id,shop_id,name,unit_label,tracking_mode)
       values ('${RESERVED_ITEM_ID}', '${SHOP_ID}', 'Cancellation rollback ingredient', 'g',
               'RECIPE_TRACKED');
     insert into public.inventory_movements(
       id,shop_id,business_day_id,inventory_item_id,movement_type,
       quantity_delta_micros,reserved_delta_micros,admin_employee_id,source_kind,
       idempotency_key,created_at
     ) values (
       gen_random_uuid(), '${SHOP_ID}', '${DAY_ID}', '${RESERVED_ITEM_ID}',
       'ADMIN_ADJUSTMENT', 10000, 0, '${REQUESTER_ID}', 'ADMIN',
       'cancel-regression-opening-stock',now()
     );
     insert into public.inventory_movements(
       id,shop_id,business_day_id,inventory_item_id,movement_type,
       quantity_delta_micros,reserved_delta_micros,worker_id,source_kind,
       idempotency_key,order_id,created_at
     ) values
       (gen_random_uuid(), '${SHOP_ID}', '${DAY_ID}', '${RESERVED_ITEM_ID}',
        'ORDER_RESERVATION',0,1500,'${WORKER_ID}','OPERATIONS',
        'cancel-regression-paid-reserve','${PAID_ACTIVE_ID}',now()),
       (gen_random_uuid(), '${SHOP_ID}', '${DAY_ID}', '${RESERVED_ITEM_ID}',
        'ORDER_RESERVATION',0,1700,'${WORKER_ID}','OPERATIONS',
        'cancel-regression-unpaid-reserve','${UNPAID_ACTIVE_ID}',now());
     insert into public.inventory_reservations(
       id,shop_id,order_id,inventory_item_id,business_day_id,quantity_micros,
       status,reserve_command_id,last_command_id,created_by_worker_id
     ) values
       ('${PAID_RESERVATION_ID}','${SHOP_ID}','${PAID_ACTIVE_ID}','${RESERVED_ITEM_ID}',
        '${DAY_ID}',1500,'ACTIVE','paid-reserve-1','paid-reserve-1','${WORKER_ID}'),
       ('${UNPAID_RESERVATION_ID}','${SHOP_ID}','${UNPAID_ACTIVE_ID}','${RESERVED_ITEM_ID}',
        '${DAY_ID}',1700,'ACTIVE','unpaid-reserve-1','unpaid-reserve-1','${WORKER_ID}');`,
  ],
  'Seed actual paid/unpaid inventory reservations for transactional rollback',
);

const guardMetadata = JSON.parse(
  psql(
    [
      '-At',
      '-c',
      `select jsonb_build_object(
         'enabled', exists(select 1 from pg_trigger where tgrelid='public.orders'::regclass
           and tgname='orders_paid_admin_cancel_guard' and tgenabled='O'),
         'anonExec', has_function_privilege('anon',
           'private.reject_paid_active_admin_cancellation_v1()', 'EXECUTE'),
         'authenticatedExec', has_function_privilege('authenticated',
           'private.reject_paid_active_admin_cancellation_v1()', 'EXECUTE'),
         'serviceExec', has_function_privilege('service_role',
           'private.reject_paid_active_admin_cancellation_v1()', 'EXECUTE')
       )::text`,
    ],
    'Cancellation trigger and principle-of-least-privilege introspection',
  ).trim(),
);
if (!guardMetadata.enabled || guardMetadata.anonExec ||
    guardMetadata.authenticatedExec || guardMetadata.serviceExec) {
  throw new Error(`Guard activation / EXECUTE grants invalid: ${JSON.stringify(guardMetadata)}`);
}

psql(
  [
    '-c',
    `do $check_paid_cancel$
     declare observed text;
     begin
       begin
         perform public.cancel_admin_order_v1(
           '${REQUESTER_ID}', '${SHOP_ID}', '${PAID_ACTIVE_ID}',
           '${CANCEL_REASON_ID}', 0, null,
           'paid-cancel-should-reject', '${BUSINESS_ID}'
         );
         raise exception 'paid ACTIVE cancellation unexpectedly succeeded';
       exception when others then
         get stacked diagnostics observed = MESSAGE_TEXT;
         if observed <> 'TUX_ADMIN_PAID_CANCEL_REQUIRES_SETTLEMENT' then
           raise;
         end if;
       end;
     end;
     $check_paid_cancel$;`,
  ],
  'Paid ACTIVE Admin cancellation must reject at the database boundary',
);

const paidState = psql(
  [
    '-At',
    '-c',
    `select o.status || ':' ||
       coalesce((select sum(p.allocated_minor) from public.payments p
         where p.order_id=o.id), 0)::text || ':' ||
       (select count(*) from public.order_status_events e
         where e.order_id=o.id and e.event_type='CANCELLED')::text || ':' ||
       (select count(*) from public.admin_order_command_receipts c
         where c.order_id=o.id)::text
       from public.orders o where o.id='${PAID_ACTIVE_ID}'`,
  ],
  'Paid cancellation rollback evidence',
).trim();
if (paidState !== 'ACTIVE:5000:0:0') {
  throw new Error(`Paid cancellation changed financial/lifecycle state: ${paidState}`);
}

const paidReservationAfterReject = JSON.parse(
  psql(
    [
      '-At',
      '-c',
      `select jsonb_build_object(
         'status', r.status,
         'lastCommandId', r.last_command_id,
         'releaseCount', (select count(*) from public.inventory_movements m
           where m.order_id='${PAID_ACTIVE_ID}' and m.movement_type='ORDER_RESERVATION_RELEASE'),
         'reservedMicros', (select sum(m.reserved_delta_micros)
           from public.inventory_movements m where m.order_id='${PAID_ACTIVE_ID}'),
         'auditCount', (select count(*) from public.admin_audit_events a
           where a.entity_id='${PAID_ACTIVE_ID}' and a.action_type='ORDER_CANCELLED')
       )::text
       from public.inventory_reservations r where r.id='${PAID_RESERVATION_ID}'`,
    ],
    'Paid cancellation must unwind release movement/reservation and audit',
  ).trim(),
);
if (
  paidReservationAfterReject.status !== 'ACTIVE' ||
  paidReservationAfterReject.lastCommandId !== 'paid-reserve-1' ||
  Number(paidReservationAfterReject.releaseCount) !== 0 ||
  Number(paidReservationAfterReject.reservedMicros) !== 1500 ||
  Number(paidReservationAfterReject.auditCount) !== 0
) {
  throw new Error(`Paid cancellation leaked effects: ${JSON.stringify(paidReservationAfterReject)}`);
}

// A second payment method on the same ACTIVE order tests mixed allocation,
// while the first attempt above establishes the partial-payment case.
psql(
  [
    '-c',
    `insert into public.payment_methods(
       id,shop_id,display_name,logic_type,requires_reconciliation,active,sort_order
     ) values (
       '58000000-0000-4000-8000-000000000092','${SHOP_ID}','Test Cash','CASH',true,true,1
     );
     insert into public.payments(
       id,shop_id,order_id,part_index,payment_method_id,
       payment_method_label_snapshot,logic_type_snapshot,allocated_minor,created_at
     ) values (
       '5b000000-0000-4000-8000-000000000093','${SHOP_ID}','${PAID_ACTIVE_ID}',2,
       '58000000-0000-4000-8000-000000000092','Test Cash','CASH',6000,now()
     );`,
  ],
  'Mixed Card and Cash allocations',
);
psql(
  [
    '-c',
    `do $mixed_paid_guard$
     declare observed text;
     begin
       begin
         perform public.cancel_admin_order_v1(
           '${REQUESTER_ID}', '${SHOP_ID}', '${PAID_ACTIVE_ID}',
           '${CANCEL_REASON_ID}', 0, 'Mixed payment guard',
           'mixed-cancel-should-reject', '${BUSINESS_ID}'
         );
         raise exception 'mixed payment ACTIVE cancellation unexpectedly succeeded';
       exception when others then
         get stacked diagnostics observed = MESSAGE_TEXT;
         if observed <> 'TUX_ADMIN_PAID_CANCEL_REQUIRES_SETTLEMENT' then raise; end if;
       end;
     end;
     $mixed_paid_guard$;`,
  ],
  'Mixed payment cancellation rejection',
);
const mixedRollback = psql(
  [
    '-At',
    '-c',
    `select o.status || ':' ||
       (select sum(p.allocated_minor) from public.payments p where p.order_id=o.id)::text || ':' ||
       (select count(*) from public.inventory_movements m where m.order_id=o.id
         and m.movement_type='ORDER_RESERVATION_RELEASE')::text || ':' ||
       (select count(*) from public.admin_order_command_receipts c where c.order_id=o.id)::text
       from public.orders o where o.id='${PAID_ACTIVE_ID}'`,
  ],
  'Mixed payment rollback evidence',
).trim();
if (mixedRollback !== 'ACTIVE:11000:0:0') {
  throw new Error(`Mixed payment cancellation changed state: ${mixedRollback}`);
}

// Explicitly prove the trigger is not a general Operations status guard.
// The direct worker-shaped transition is rolled back inside this isolated transaction.
psql(
  [
    '-c',
    `begin;
     update public.orders set status='CANCELLED',
       cancelled_by_worker_id='${WORKER_ID}',
       cancelled_by_admin_employee_id=null
       where id='${PAID_ACTIVE_ID}' and status='ACTIVE';
     do $scope_check$
     begin
       if not exists(select 1 from public.orders
         where id='${PAID_ACTIVE_ID}' and status='CANCELLED') then
         raise exception 'non-Admin lifecycle transition was blocked';
       end if;
     end;
     $scope_check$;
     rollback;`,
  ],
  'Worker-shaped lifecycle transition is outside Admin-only guard',
);

const unpaidCancel = rpc(
  `public.cancel_admin_order_v1(
    '${REQUESTER_ID}', '${SHOP_ID}', '${UNPAID_ACTIVE_ID}',
    '${CANCEL_REASON_ID}', 0, 'Unpaid cancellation',
    'unpaid-cancel-1', '${BUSINESS_ID}'
  )`,
  'Unpaid ACTIVE cancellation',
);
if (unpaidCancel.ok !== true || unpaidCancel.status !== 'CANCELLED' || unpaidCancel.replayed) {
  throw new Error(`Unpaid cancellation not committed: ${JSON.stringify(unpaidCancel)}`);
}
const unpaidReplay = rpc(
  `public.cancel_admin_order_v1(
    '${REQUESTER_ID}', '${SHOP_ID}', '${UNPAID_ACTIVE_ID}',
    '${CANCEL_REASON_ID}', 0, 'Unpaid cancellation',
    'unpaid-cancel-1', '${BUSINESS_ID}'
  )`,
  'Unpaid cancellation idempotent replay',
);
if (unpaidReplay.ok !== true || unpaidReplay.replayed !== true) {
  throw new Error(`Unpaid cancellation replay not idempotent: ${JSON.stringify(unpaidReplay)}`);
}

const unpaidReleaseState = psql(
  [
    '-At',
    '-c',
    `select r.status || ':' ||
       (select count(*) from public.inventory_movements m
         where m.order_id='${UNPAID_ACTIVE_ID}' and m.movement_type='ORDER_RESERVATION_RELEASE')::text ||
       ':' || (select coalesce(sum(m.reserved_delta_micros),0) from public.inventory_movements m
         where m.order_id='${UNPAID_ACTIVE_ID}')::text
       from public.inventory_reservations r where r.id='${UNPAID_RESERVATION_ID}'`,
  ],
  'Unpaid cancellation releases its reserved inventory once',
).trim();
if (unpaidReleaseState !== 'RELEASED:1:0') {
  throw new Error(`Unpaid cancellation did not safely release stock: ${unpaidReleaseState}`);
}

console.log(
  'Paid ACTIVE cancellation guard and unpaid rollback/replay PostgreSQL behavior passed.',
);
