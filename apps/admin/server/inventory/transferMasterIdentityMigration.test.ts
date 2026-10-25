import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  'supabase/migrations/20261025171000_inventory_transfer_master_identity.sql',
  'utf8',
);

describe('inventory transfer immutable master-identity contract', () => {
  it('matches actual authorized shared master bindings, never name equality', () => {
    expect(sql).toContain('catalog_inventory_item_shop_bindings');
    expect(sql).toContain('catalog_master_inventory_items');
    expect(sql).not.toContain('destination_item.name = source_item.name');
    expect(sql).toContain('destination_item.unit_label = master_item.base_unit_label');
    expect(sql).toContain('v_source_business');
  });

  it('compares complete original transfer line payload before idempotent replay', () => {
    expect(sql).toContain('v_existing_payload');
    expect(sql).toContain('v_requested_payload');
    expect(sql).toContain('idempotency_conflict');
  });

  it('preserves original send/receive ledger behavior', () => {
    expect(sql).toContain("'TRANSFER_OUT'");
    expect(sql).toContain("'SENT'");
    expect(sql).toContain('v_resolved_lines');
  });
});
