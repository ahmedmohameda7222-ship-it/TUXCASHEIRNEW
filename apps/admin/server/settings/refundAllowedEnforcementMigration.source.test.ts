import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../supabase/migrations',
);

describe('payment-method refund eligibility authority', () => {
  it('snapshots trusted policy on new payments and preserves historical settlement eligibility', () => {
    const files = readdirSync(migrationsDir).filter((name) =>
      name.endsWith('_admin_payment_refund_allowed_enforcement.sql'),
    );
    expect(files).toHaveLength(1);
    const sql = readFileSync(join(migrationsDir, files[0]!), 'utf8');
    expect(sql).toContain('refund_allowed_snapshot');
    expect(sql).toContain('BEFORE INSERT ON public.payments');
    expect(sql).toContain('public.payment_methods');
    expect(sql).toContain('NEW.refund_allowed_snapshot');
    expect(sql).toContain('execute_approved_admin_order_refund_v1');
    expect(sql).toContain('request_admin_order_refund_v1');
    expect(sql).toContain('refund_not_allowed_for_payment');
    expect(sql).toContain('update_admin_payment_method_v1');
    expect(sql).toContain('refund_allowed = p_refund_allowed');
    expect(sql).toContain('append_admin_audit_event_v1');
  });
});
