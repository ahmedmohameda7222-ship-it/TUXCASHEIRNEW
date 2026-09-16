import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath =
  'supabase/migrations/20260910122900_admin_plan2_final_review_round14_hardening.sql';

describe('Plan 2 round 14 SHOP_CONFIG hardening', () => {
  it('adds additive lineage semantics instead of editing the already-live round 13 migrations', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();
    expect(sql).toContain('settings_publication_kind');
    expect(sql).toContain("'emergency_operational_state'");
    expect(sql).toContain("'scheduled_online_orders_state'");
  });

  it('allows only emergency/patch lineage to rebase an accepted schedule', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();
    expect(sql).toContain('apply_scheduled_shop_config_change_v1');
    expect(sql).toContain("'emergency_operational_state', 'scheduled_online_orders_state'");
    expect(sql).toContain('stale_settings_version');
  });

  it('keeps independent SHOP_CONFIG rows instead of cancelling every pending shop action', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();
    expect(sql).toContain('schedule_admin_shop_config_v1');
    expect(sql).not.toContain("last_error = 'replaced_by_reschedule'");
    expect(sql).not.toContain("where s.shop_id = p_shop_id\n      and s.change_kind = 'shop_config'\n      and s.status in ('pending', 'failed')");
  });
});
