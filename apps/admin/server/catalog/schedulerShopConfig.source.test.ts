import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function sourceOrEmpty(path: string): string {
  try {
    return source(path);
  } catch {
    return '';
  }
}

describe('Plan 2 scheduled shop configuration', () => {
  it('claims and executes SHOP_CONFIG through a dedicated scheduler authority path', () => {
    const scheduler = source('./scheduler.ts');
    const migration = sourceOrEmpty(
      '../../../../supabase/migrations/20260910122700_admin_plan2_final_review_round13_hardening.sql',
    );

    expect(scheduler).toContain("'SHOP_CONFIG'");
    expect(scheduler).toContain('applyShopConfig');
    expect(scheduler).toContain('apply_scheduled_shop_config_change_v1');
    expect(migration).toContain("'CATALOG_PUBLISH', 'PRODUCT_AVAILABILITY', 'SHOP_CONFIG'");
    expect(migration).toContain('schedule_shop_settings_publish_v1');
    expect(migration).toContain('schedule_shop_online_orders_state_v1');
    expect(migration).toContain('apply_scheduled_shop_config_change_v1');
  });

  it('stores a validated settings snapshot at schedule acceptance instead of reading mutable rows at execution', () => {
    const migration = sourceOrEmpty(
      '../../../../supabase/migrations/20260910122700_admin_plan2_final_review_round13_hardening.sql',
    ).toLowerCase();

    expect(migration).toContain('build_effective_shop_settings_payload_v1');
    expect(migration).toContain("'settingspayload'");
    expect(migration).toContain('target_base_settings_version');
  });
});
