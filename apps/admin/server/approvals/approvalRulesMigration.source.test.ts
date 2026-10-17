import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../supabase/migrations',
);

describe('approval-rule management trust boundary', () => {
  it('keeps rule edits version-fenced, audited and limited to existing settings authority', () => {
    const name = readdirSync(migrationsDir).find((file) =>
      file.endsWith('_admin_approval_rule_management.sql'),
    );
    expect(name).toBeDefined();
    const sql = readFileSync(join(migrationsDir, name!), 'utf8');
    expect(sql).toContain('edit_version');
    expect(sql).toContain('private.assert_admin_settings_permission_v1');
    expect(sql).toContain('private.assert_admin_business_settings_permission_v1');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('stale_approval_rule_version');
    expect(sql).toContain('admin_audit_events');
    expect(sql).toContain('jsonb_each');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.upsert_admin_approval_rule_v1');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.upsert_admin_approval_rule_v1');
    expect(sql).not.toContain('DELETE FROM public.admin_approval_rules');
  });
});
