import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const sql = readFileSync(
  new URL(
    '../../../../supabase/migrations/20261011033703_admin_supplier_lifecycle.sql',
    import.meta.url,
  ),
  'utf8',
);
describe('supplier lifecycle management', () => {
  it('preserves history and enforces business-wide authority', () => {
    for (const token of [
      'business_employees',
      'OWNER',
      'ADMIN',
      'private.admin_purchasing_authority_v1',
      'version',
      'active',
      'append_admin_audit_event_v1',
    ])
      expect(sql).toContain(token);
    expect(sql).not.toMatch(/delete\s+from\s+public\.suppliers/i);
  });
  it('prevents stale, double-tap and unauthorized changes', () => {
    for (const token of [
      'stale_version',
      'idempotency_conflict',
      'request_digest',
      'REVOKE ALL ON FUNCTION',
      'GRANT EXECUTE ON FUNCTION',
    ])
      expect(sql).toContain(token);
  });
});
