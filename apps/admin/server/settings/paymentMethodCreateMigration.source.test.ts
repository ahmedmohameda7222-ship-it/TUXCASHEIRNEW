import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../supabase/migrations',
);

describe('canonical payment method creation', () => {
  it('uses authorized idempotent commands, settings CAS and audit with private policy defaults', () => {
    const matches = readdirSync(migrationsDir).filter((name) =>
      name.endsWith('_admin_payment_method_create.sql'),
    );
    expect(matches).toHaveLength(1);
    const sql = readFileSync(join(migrationsDir, matches[0]!), 'utf8');
    expect(sql).toContain('private.assert_admin_settings_permission_v1');
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain('admin_payment_method_create_commands');
    expect(sql).toContain('stale_settings_version');
    expect(sql).toContain('public.admin_audit_events');
    expect(sql).toContain('refund_allowed');
    expect(sql).toContain('true');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.create_admin_payment_method_v1');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.create_admin_payment_method_v1');
  });
});
