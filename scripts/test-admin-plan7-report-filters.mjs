import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const sql=readFileSync('supabase/migrations/20261008135000_admin_plan7_report_context_filters.sql','utf8');
for(const field of ['orderTypeId','paymentMethodId','workerId','customerId','productId','categoryId','promotionId','supplierId','deliveryZoneId','status']) {
  assert(sql.includes(field), 'missing server-authoritative contextual filter '+field);
}
assert.match(sql,/create or replace function public\.admin_finance_report_query_v2/);
assert.match(sql,/resolve_admin_authorization_v1/);
assert.match(sql,/revoke all on function public\.admin_finance_report_query_v2/);
assert.match(sql,/grant execute on function public\.admin_finance_report_query_v2/);
console.log('Plan 7 contextual report filters and authorization invariant passed.');
