import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  'supabase/migrations/20261025170000_inventory_offshift_quiescence.sql',
  'utf8',
);

describe('trusted stocktake after-shift migration contract', () => {
  it('uses current server-side Operations sessions and outstanding orders, not financial day closure', () => {
    expect(sql).toContain('public.worker_sessions');
    expect(sql).toContain('ended_at is null');
    expect(sql).toContain('public.orders');
    expect(sql).not.toMatch(/business_days\s+.*status\s*=\s*'CLOSED'/);
  });

  it('rechecks eligibility at both actual BEGIN and POST database writes', () => {
    expect(sql).toContain('before insert on public.stocktakes');
    expect(sql).toContain('before update of status on public.stocktakes');
    expect(sql).toContain('stocktake_requires_off_shift');
  });

  it('aborts an old count if any other ledger movement arrived after begin, excluding only the same-post adjustment', () => {
    expect(sql).toContain('public.inventory_movements');
    expect(sql).toContain('m.created_at > old.started_at');
    expect(sql).toContain('m.command_id = new.post_command_id');
    expect(sql).toContain('stocktake_snapshot_stale');
  });

  it('limits definer preflight to authorized service-role calls', () => {
    expect(sql).toContain('private.admin_inventory_authority_v1');
    expect(sql).toContain('revoke all on function public.read_admin_stocktake_quiescence_v1');
    expect(sql).toContain('grant execute on function public.read_admin_stocktake_quiescence_v1');
  });
});
