import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../supabase/migrations',
);

describe('payment-method delivery-zone restrictions', () => {
  it('uses versioned authorized canonical zone rules, audits edits and prevents client RPC access', () => {
    const files = readdirSync(migrationsDir).filter((file) =>
      file.endsWith('_admin_payment_zone_restrictions.sql'),
    );
    expect(files).toHaveLength(1);
    const sql = readFileSync(join(migrationsDir, files[0]!), 'utf8');
    expect(sql).toContain('private.assert_admin_settings_permission_v1');
    expect(sql).toContain('payment_method_zone_rules');
    expect(sql).toContain('p_expected_allowed');
    expect(sql).toContain('p_expected_settings_version');
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain('admin_audit_events');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.upsert_admin_payment_zone_rule_v1');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.upsert_admin_payment_zone_rule_v1');
  });
});
