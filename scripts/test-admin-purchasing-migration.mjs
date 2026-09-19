import fs from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve('supabase/migrations/20260910150000_admin_purchasing.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');
const lower = sql.toLowerCase();

for (const name of [
  'suppliers',
  'supplier_inventory_items',
  'purchase_orders',
  'purchase_order_lines',
  'purchase_receipts',
  'purchase_receipt_lines',
  'purchase_returns',
  'purchase_return_lines',
  'supplier_price_history',
  'receive_purchase_order_v1',
  'return_purchase_order_v1',
]) {
  if (!lower.includes(name)) throw new Error(`missing purchasing contract: ${name}`);
}

for (const status of [
  'draft',
  'ordered',
  'partially_received',
  'received',
  'cancelled',
]) {
  if (!lower.includes(`'${status}'`)) throw new Error(`missing PO status: ${status}`);
}

for (const table of [
  'suppliers',
  'supplier_inventory_items',
  'purchase_orders',
  'purchase_order_lines',
  'purchase_receipts',
  'purchase_receipt_lines',
  'purchase_returns',
  'purchase_return_lines',
  'supplier_price_history',
]) {
  if (!lower.includes(`alter table public.${table} enable row level security`)) {
    throw new Error(`missing RLS: ${table}`);
  }
  if (!lower.includes(`revoke all on public.${table} from public, anon, authenticated`)) {
    throw new Error(`missing browser ACL revocation: ${table}`);
  }
}

for (const fn of ['receive_purchase_order_v1', 'return_purchase_order_v1']) {
  const revoke = new RegExp(
    `revoke\\s+(?:all|execute)\\s+on\\s+function\\s+public\\.${fn}[\\s\\S]*?from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`,
  );
  const grant = new RegExp(
    `grant\\s+execute\\s+on\\s+function\\s+public\\.${fn}[\\s\\S]*?to\\s+service_role`,
  );
  if (!revoke.test(lower)) throw new Error(`${fn} must revoke browser execution`);
  if (!grant.test(lower)) throw new Error(`${fn} must grant service_role execution`);
}

if (!lower.includes('purchase_receipt')) {
  throw new Error('receiving must append PURCHASE_RECEIPT inventory movements');
}
if (!lower.includes('purchase_return')) {
  throw new Error('returns must append PURCHASE_RETURN inventory movements');
}
if (!lower.includes('inventory_cost_state')) {
  throw new Error('receiving must update canonical weighted-average cost state');
}
if (!lower.includes('supplier_price_history')) {
  throw new Error('receiving must persist supplier price history');
}
if (!lower.includes('append_admin_audit_event_v1') && !lower.includes('admin_audit_events')) {
  throw new Error('receiving/returns must write audit state in the trusted transaction');
}
if (!lower.includes('for update')) {
  throw new Error('purchase-order mutations must serialize on canonical PO/line state');
}
if (!lower.includes('expected_delivery_date') || !lower.includes('reference')) {
  throw new Error('purchase orders need editable expected-delivery date and reference');
}
if (!lower.includes('preferred_supplier_id')) {
  throw new Error('purchasing must bind replenishment preferred supplier to canonical suppliers');
}

console.log('Admin purchasing migration static invariant passed.');
