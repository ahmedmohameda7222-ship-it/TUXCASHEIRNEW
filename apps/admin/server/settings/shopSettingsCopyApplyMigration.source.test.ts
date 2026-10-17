import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../supabase/migrations',
);

describe('selective shop settings copy authority', () => {
  it('preflights both shop snapshots and commits through authorized CAS writes', () => {
    const file = readdirSync(migrationsDir).find((name) =>
      name.endsWith('_admin_selective_shop_settings_copy.sql'),
    );
    expect(file).toBeDefined();
    const sql = readFileSync(join(migrationsDir, file!), 'utf8');
    expect(sql).toContain('private.assert_admin_settings_permission_v1');
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain('stale_copy_preview');
    expect(sql).toContain('public.upsert_shop_setting_override_v1');
    expect(sql).toContain('public.admin_audit_events');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.apply_admin_shop_settings_copy_v1');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.apply_admin_shop_settings_copy_v1');
  });
});
