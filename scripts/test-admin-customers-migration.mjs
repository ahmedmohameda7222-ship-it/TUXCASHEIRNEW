import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationPath = new URL(
  '../supabase/migrations/20260910170000_admin_customers.sql',
  import.meta.url,
);

assert.equal(fs.existsSync(migrationPath), true, 'Plan 5 customer migration must exist');
const sql = fs.readFileSync(migrationPath, 'utf8');

const requiredPatterns = [
  [/create table public\.business_customers/i, 'business-level customer identities'],
  [/unique\s*\(business_id,\s*normalized_phone\)/i, 'business phone identity uniqueness'],
  [/create table public\.customer_shop_links/i, 'legacy shop-contact links'],
  [/create table public\.customer_addresses/i, 'customer addresses'],
  [/create table public\.customer_segments/i, 'customer segments'],
  [/alter table public\.customer_contacts[\s\S]*canonical_customer_id/i, 'additive legacy contact mapping'],
  [/from public\.customer_contacts/i, 'existing contact backfill'],
  [/join public\.business_shops/i, 'business ownership backfill'],
  [/create or replace function public\.merge_admin_customers_v1/i, 'trusted customer merge RPC'],
  [/customers\.merge/i, 'customer merge permission authority'],
  [/p_confirmed/i, 'explicit merge confirmation'],
  [/for update/i, 'merge row locking'],
  [/merged_into_customer_id/i, 'future lookup redirect to survivor'],
  [/append_admin_audit_event_v1/i, 'immutable merge audit event'],
  [/revoke all on function public\.merge_admin_customers_v1/i, 'browser merge RPC denial'],
  [/grant execute on function public\.merge_admin_customers_v1/i, 'service-role merge grant'],
];

for (const [pattern, label] of requiredPatterns) {
  assert.match(sql, pattern, `Customer migration is missing ${label}`);
}

assert.doesNotMatch(
  sql,
  /update\s+public\.orders[\s\S]{0,600}customer_contact_id/i,
  'Customer canonicalization must not rewrite historical order contact references',
);
assert.doesNotMatch(
  sql,
  /join[\s\S]{0,120}customer_contacts[\s\S]{0,120}\bname\b\s*=/i,
  'Same customer name alone must never be an automatic merge key',
);

console.log('Admin Plan 5 customer migration source invariants passed.');
