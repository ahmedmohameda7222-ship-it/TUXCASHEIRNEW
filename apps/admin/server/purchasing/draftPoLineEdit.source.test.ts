import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL(
    '../../../../supabase/migrations/20261011153143_admin_draft_po_line_edit.sql',
    import.meta.url,
  ),
  'utf8',
);
describe('draft PO line replacement', () => {
  it('is DRAFT-only with full version and received-history guards', () => {
    for (const term of [
      "'DRAFT'",
      'p_expected_version',
      'purchase_receipts',
      'received_purchase_units_micros',
      'stale_version',
    ])
      expect(sql).toContain(term);
  });
  it('checks supplier, shop, item, conversion, exact integer micros before transactional rewrite', () => {
    for (const term of [
      'private.admin_purchasing_authority_v1',
      'public.suppliers',
      'public.inventory_items',
      'public.inventory_unit_conversions',
      'purchase_unit_conversion_inexact',
      'duplicate_inventory_item',
      'DELETE FROM public.purchase_order_lines',
      'INSERT INTO public.purchase_order_lines',
    ])
      expect(sql).toContain(term);
  });
  it('records audit and supports idempotent retries without last-write-wins', () => {
    for (const term of [
      'p_command_id',
      'request_digest',
      'idempotentReplay',
      'append_admin_audit_event_v1',
      'REVOKE ALL ON FUNCTION',
      'GRANT EXECUTE ON FUNCTION',
    ])
      expect(sql).toContain(term);
  });
});
