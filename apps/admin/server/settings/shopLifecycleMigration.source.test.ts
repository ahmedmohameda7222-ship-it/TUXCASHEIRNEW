import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../supabase/migrations');

describe('shop lifecycle transition authority', () => {
  it('uses explicit version fencing, tenant authorization, audit and service-role-only grants', () => {
    const files = readdirSync(migrationsDir).filter((name) =>
      name.endsWith('_admin_shop_lifecycle_transitions.sql'),
    );
    expect(files).toHaveLength(1);
    const sql = readFileSync(join(migrationsDir, files[0]!), 'utf8');
    expect(sql).toContain('private.assert_admin_settings_permission_v1');
    expect(sql).toContain('shops.manage');
    expect(sql).toContain('lifecycle_revision');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain("v_current.lifecycle_state = 'ARCHIVED'");
    expect(sql).toContain('admin_audit_events');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.update_admin_shop_lifecycle_v1');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.update_admin_shop_lifecycle_v1');
  });
});
