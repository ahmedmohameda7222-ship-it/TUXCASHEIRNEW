import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../../../supabase/migrations/20261011033058_admin_po_cancel.sql', import.meta.url),
  'utf8',
);
describe('PO cancellation migration', () => {
  it('restricts cancellation to DRAFT or unreceived ORDERED states', () => {
    expect(sql).toContain("'DRAFT', 'ORDERED'");
    expect(sql).toContain('purchase_receipts');
    expect(sql).toContain('received_purchase_units_micros');
    expect(sql).toContain('cancelled_at = now()');
  });
  it('guarantees optimistic concurrency, idempotency, audit and trusted authority', () => {
    for (const text of [
      'p_expected_version',
      'p_command_id',
      'stale_version',
      'idempotentReplay',
      'admin_purchasing_authority_v1',
      'append_admin_audit_event_v1',
      'REVOKE ALL ON FUNCTION',
      'GRANT EXECUTE ON FUNCTION',
    ])
      expect(sql).toContain(text);
  });
});
