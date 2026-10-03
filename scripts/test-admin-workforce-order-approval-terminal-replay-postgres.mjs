import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('Admin Workforce order approval terminal replay skipped without TEST_DATABASE_URL.');
  process.exit(0);
}
const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Admin Workforce order approval terminal replay test refuses non-loopback PostgreSQL.');
}

function run(command, args, label) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}`);
  }
  return result.stdout;
}

function psql(args, label) {
  return run('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', ...args], label);
}

function scalar(sql, label) {
  return psql(['-At', '-c', sql], label).trim();
}

function rpc(sql, label) {
  return JSON.parse(scalar(`select (${sql})::text`, label));
}

run('node', ['scripts/test-admin-order-approval-postgres.mjs'], 'Plan 5 order approval fixture');
psql(
  ['-f', resolve('supabase/migrations/20261003101700_admin_order_approval_terminal_receipts.sql')],
  'Terminal order approval receipt migration',
);

const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
const SHOP_ID = '51000000-0000-4000-8000-000000000001';
const REQUESTER_ID = '52000000-0000-4000-8000-000000000001';
const APPROVER_ID = '52000000-0000-4000-8000-000000000002';
const ORDER_ID = '59000000-0000-4000-8000-000000000001';
const ITEM_ID = '5a000000-0000-4000-8000-000000000001';
const PAYMENT_ID = '5b000000-0000-4000-8000-000000000001';
const REASON_ID = '5c000000-0000-4000-8000-000000000001';

const rejectedRefundReplay = rpc(
  `public.request_admin_order_refund_v1(
    '${REQUESTER_ID}', '${SHOP_ID}', '${ORDER_ID}', '${PAYMENT_ID}',
    5000, '${REASON_ID}', 'Reject this refund', 'refund-rejected-1', '${BUSINESS_ID}'
  )`,
  'Rejected refund replay',
);
if (rejectedRefundReplay.ok !== false || rejectedRefundReplay.code !== 'approval_rejected') {
  throw new Error(
    `rejected refund replay remained pending: ${JSON.stringify(rejectedRefundReplay)}`,
  );
}
if (
  scalar(
    `select state from public.admin_order_refunds where business_id='${BUSINESS_ID}' and shop_id='${SHOP_ID}' and command_id='refund-rejected-1'`,
    'Rejected refund durable state',
  ) !== 'REJECTED'
) {
  throw new Error('rejected refund row remained PENDING_APPROVAL');
}

const rejectedReturnReplay = rpc(
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
  'Rejected return replay',
);
if (rejectedReturnReplay.ok !== false || rejectedReturnReplay.code !== 'approval_rejected') {
  throw new Error(
    `rejected return replay remained pending: ${JSON.stringify(rejectedReturnReplay)}`,
  );
}
if (
  scalar(
    `select state from public.admin_order_returns where business_id='${BUSINESS_ID}' and shop_id='${SHOP_ID}' and command_id='return-rejected-1'`,
    'Rejected return durable state',
  ) !== 'REJECTED'
) {
  throw new Error('rejected return row remained PENDING_APPROVAL');
}

const failedRefund = rpc(
  `public.request_admin_order_refund_v1(
    '${REQUESTER_ID}', '${SHOP_ID}', '${ORDER_ID}', '${PAYMENT_ID}',
    5000, '${REASON_ID}', 'Fail execution', 'refund-failed-1', '${BUSINESS_ID}'
  )`,
  'Refund awaiting terminal execution failure',
);
if (
  failedRefund.ok !== true ||
  failedRefund.state !== 'PENDING_APPROVAL' ||
  typeof failedRefund.approvalRequestId !== 'string'
) {
  throw new Error(`failed-refund fixture was not held: ${JSON.stringify(failedRefund)}`);
}

const approveFailedRefund = rpc(
  `public.decide_admin_approval_request_v1(
    '${failedRefund.approvalRequestId}'::uuid,
    '${APPROVER_ID}'::uuid,
    null,
    'APPROVE',
    'approve before forced terminal failure'
  )`,
  'Approve failed-refund fixture',
);
if (approveFailedRefund.ok !== true || approveFailedRefund.status !== 'APPROVED') {
  throw new Error(`failed-refund approval failed: ${JSON.stringify(approveFailedRefund)}`);
}

const claimOutput = psql(
  [
    '-At',
    '-c',
    `select to_jsonb(claim)::text
     from public.claim_admin_approval_execution_v1(
       'plan6-terminal-replay-test',
       now(),
       25,
       300
     ) claim
     where claim.approval_request_id = '${failedRefund.approvalRequestId}'::uuid`,
  ],
  'Claim failed-refund approval execution',
).trim();
if (!claimOutput) throw new Error('failed-refund approval did not produce an execution claim');
const claim = JSON.parse(claimOutput);

const failedCompletion = rpc(
  `public.complete_admin_approval_execution_v1(
    '${failedRefund.approvalRequestId}'::uuid,
    '${claim.claim_token}',
    'FAILED',
    'forced_terminal_test_failure',
    null,
    now()
  )`,
  'Complete refund approval with terminal failure',
);
if (failedCompletion.ok !== true || failedCompletion.status !== 'FAILED') {
  throw new Error(`terminal approval failure was not committed: ${JSON.stringify(failedCompletion)}`);
}
if (
  scalar(
    `select state from public.admin_order_refunds where business_id='${BUSINESS_ID}' and shop_id='${SHOP_ID}' and command_id='refund-failed-1'`,
    'Failed refund durable state',
  ) !== 'FAILED'
) {
  throw new Error('failed refund row remained PENDING_APPROVAL');
}

const failedRefundReplay = rpc(
  `public.request_admin_order_refund_v1(
    '${REQUESTER_ID}', '${SHOP_ID}', '${ORDER_ID}', '${PAYMENT_ID}',
    5000, '${REASON_ID}', 'Fail execution', 'refund-failed-1', '${BUSINESS_ID}'
  )`,
  'Failed refund replay',
);
if (
  failedRefundReplay.ok !== false ||
  failedRefundReplay.code !== 'approval_execution_failed'
) {
  throw new Error(
    `failed refund replay remained pending: ${JSON.stringify(failedRefundReplay)}`,
  );
}

console.log('Admin Workforce cross-plan terminal approval replay behavior passed.');
