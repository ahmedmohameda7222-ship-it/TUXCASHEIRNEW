import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../supabase/migrations',
);

describe('shop lifecycle management', () => {
  it('requires shop authority, monotonic CAS, audit and service-only RPC grants', () => {
    const matches = readdirSync(migrationsDir).filter((name) =>
      name.endsWith('_admin_shop_lifecycle_management.sql'),
    );
    expect(matches).toHaveLength(1);
    const sql = readFileSync(join(migrationsDir, matches[0]!), 'utf8');
    expect(sql).toContain('lifecycle_edit_version');
    expect(sql).toContain('private.assert_admin_settings_permission_v1');
    expect(sql).toContain("'shops.manage'");
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('stale_shop_lifecycle_version');
    expect(sql).toContain('public.admin_audit_events');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.update_admin_shop_lifecycle_v1');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.update_admin_shop_lifecycle_v1');
    expect(sql).not.toContain('DELETE FROM public.orders');
  });
});
