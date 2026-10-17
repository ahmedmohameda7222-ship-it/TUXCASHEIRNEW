import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../supabase/migrations',
);

describe('shop setting override inheritance restoration', () => {
  it('uses authorized atomic deletion, audit and monotonic revision fencing', () => {
    const files = readdirSync(migrationsDir).filter((name) =>
      name.endsWith('_admin_restore_inherited_settings.sql'),
    );
    expect(files).toHaveLength(1);
    const sql = readFileSync(join(migrationsDir, files[0]!), 'utf8');
    expect(sql).toContain('private.assert_admin_settings_permission_v1');
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain('shop_setting_override_revision_fences');
    expect(sql).toContain('DELETE FROM public.shop_setting_overrides');
    expect(sql).toContain('public.admin_audit_events');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.restore_shop_setting_override_v1');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.restore_shop_setting_override_v1');
  });
});
