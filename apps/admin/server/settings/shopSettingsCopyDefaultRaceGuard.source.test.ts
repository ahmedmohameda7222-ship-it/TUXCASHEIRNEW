import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../supabase/migrations',
);

describe('shop settings copy business-default concurrency', () => {
  it('takes canonical per-key default locks before reading source and target values', () => {
    const files = readdirSync(migrationsDir).filter((file) =>
      file.endsWith('_admin_selective_shop_copy_default_race_guard.sql'),
    );
    expect(files).toHaveLength(1);
    const sql = readFileSync(join(migrationsDir, files[0]!), 'utf8');
    expect(sql).toContain('tux-admin-setting-default:');
    expect(sql).toContain('pg_advisory_xact_lock(v_lock)');
    expect(sql).toContain('public.apply_admin_shop_settings_copy_v1');
    expect(sql.indexOf('tux-admin-setting-default:')).toBeLessThan(
      sql.indexOf('SELECT COALESCE(MAX(s.settings_version), 0) INTO v_source_published'),
    );
    expect(sql).toContain('v_current_preview <> p_expected_changes');
    expect(sql).toContain('public.upsert_shop_setting_override_v1');
  });
});
