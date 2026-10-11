import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../supabase/migrations',
);

describe('archived shop selective copy prohibition', () => {
  it('locks both shop lifecycle rows and rejects archived source or target shops', () => {
    const name = readdirSync(migrationsDir).find((file) =>
      file.endsWith('_admin_selective_shop_copy_archived_guard.sql'),
    );
    expect(name).toBeDefined();
    const sql = readFileSync(join(migrationsDir, name!), 'utf8');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain("v_lifecycle_state = 'ARCHIVED'");
    expect(sql).toContain('archived_shop_copy_forbidden');
    expect(sql).toContain('private.assert_admin_settings_permission_v1');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.apply_admin_shop_settings_copy_v1');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.apply_admin_shop_settings_copy_v1');
  });
});
