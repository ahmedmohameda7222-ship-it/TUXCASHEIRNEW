import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../supabase/migrations',
);

describe('configurable refund eligibility on payment creation', () => {
  it('requires a typed refundAllowed flag in audited idempotent creation', () => {
    const files = readdirSync(migrationsDir).filter((name) =>
      name.endsWith('_admin_payment_method_refund_create.sql'),
    );
    expect(files).toHaveLength(1);
    const sql = readFileSync(join(migrationsDir, files[0]!), 'utf8');
    expect(sql).toContain('create_admin_payment_method_v2');
    expect(sql).toContain('p_refund_allowed boolean');
    expect(sql).toContain('p_refund_allowed IS NULL');
    expect(sql).toContain("'refundAllowed',p_refund_allowed");
    expect(sql).toContain('admin_payment_method_create_commands');
    expect(sql).toContain('refund_allowed');
    expect(sql).toContain('append_admin_audit_event_v1');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.create_admin_payment_method_v2');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.create_admin_payment_method_v2');
  });
});
