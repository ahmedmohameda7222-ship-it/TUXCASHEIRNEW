import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const sql = readFileSync(
  new URL(
    '../../../../supabase/migrations/20261011042028_admin_order_type_create.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('order-type creation authority', () => {
  it('requires trusted shop settings authorization, version guard and deterministic replay', () => {
    for (const field of [
      'assert_admin_settings_permission_v1',
      'business_shops',
      'p_expected_settings_version',
      'stale_settings_version',
      'p_command_id',
      'idempotency_conflict',
      'idempotentReplay',
    ])
      expect(sql).toContain(field);
  });
  it('creates without deleting or relabeling historical orders, and audits the definition', () => {
    expect(sql).toContain('INSERT INTO public.order_types');
    expect(sql).toContain('append_admin_audit_event_v1');
    expect(sql).not.toMatch(/delete\s+from\s+public\.order_types/i);
    expect(sql).toContain('REVOKE ALL ON FUNCTION');
  });
});
