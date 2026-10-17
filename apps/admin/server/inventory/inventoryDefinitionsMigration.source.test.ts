import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL(
    '../../../../supabase/migrations/20261011032824_admin_inventory_definition_management.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('inventory definition migration', () => {
  it('protects semantic changes to historical inventory definitions', () => {
    for (const relation of [
      'inventory_movements',
      'inventory_reservations',
      'recipe_lines',
      'purchase_order_lines',
      'stocktake_lines',
      'stock_transfer_lines',
    ])
      expect(sql).toContain(relation);
    expect(sql).toContain('inventory_semantic_change_forbidden');
  });
  it('authorizes inside trusted RPC and preserves audit/idempotency/version checks', () => {
    expect(sql).toContain('private.admin_purchasing_authority_v1');
    expect(sql).toContain('p_expected_version');
    expect(sql).toContain('idempotency_conflict');
    expect(sql).toContain('append_admin_audit_event_v1');
    expect(sql).toContain('REVOKE ALL ON FUNCTION');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION');
  });
});
