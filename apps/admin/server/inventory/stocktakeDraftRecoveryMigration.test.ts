import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  'supabase/migrations/20261025173000_inventory_stocktake_draft_recovery.sql',
  'utf8',
);

describe('persistent after-shift stocktake drafts', () => {
  it('supports authorized resume, saved partial counts, and cancellation', () => {
    expect(sql).toContain('read_admin_stocktake_sessions_v1');
    expect(sql).toContain('save_admin_stocktake_draft_v1');
    expect(sql).toContain('cancel_admin_stocktake_draft_v1');
    expect(sql).toContain("status = 'CANCELLED'");
    expect(sql).toContain('inventory.stocktake');
  });

  it('fences concurrent and replayed draft writes', () => {
    expect(sql).toContain('for update');
    expect(sql).toContain('draft_revision');
    expect(sql).toContain('idempotency_conflict');
    expect(sql).toContain('stocktake_snapshot_stale');
    expect(sql).toContain('stocktake_requires_off_shift');
    expect(sql).toContain('stocktake_line_set_mismatch');
  });

  it('revokes direct browser execution on all new recovery commands', () => {
    expect((sql.match(/from public, anon, authenticated/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((sql.match(/to service_role/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
