import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../supabase/migrations',
);

describe('immutable payment refund policy authority', () => {
  it('captures the payment-method refund decision at payment creation', () => {
    const files = readdirSync(migrationsDir).filter((name) =>
      name.endsWith('_admin_payment_refund_policy_snapshot.sql'),
    );
    expect(files).toHaveLength(1);
    const sql = readFileSync(join(migrationsDir, files[0]!), 'utf8');
    expect(sql).toContain('refund_allowed_snapshot');
    expect(sql).toContain('CREATE TRIGGER payments_capture_refund_policy');
    expect(sql).toContain('private.capture_payment_refund_policy_v1()');
    expect(sql).toContain('NEW.refund_allowed_snapshot := v_refund_allowed');
  });

  it('enforces the immutable original policy at refund posting, including approval execution', () => {
    const files = readdirSync(migrationsDir).filter((name) =>
      name.endsWith('_admin_payment_refund_policy_snapshot.sql'),
    );
    expect(files).toHaveLength(1);
    const sql = readFileSync(join(migrationsDir, files[0]!), 'utf8');
    expect(sql).toContain('CREATE TRIGGER admin_order_refunds_enforce_payment_policy');
    expect(sql).toContain('private.enforce_admin_refund_payment_policy_v1()');
    expect(sql).toContain('TUX_ADMIN_PAYMENT_REFUND_NOT_ALLOWED');
    expect(sql).toContain('BEFORE INSERT OR UPDATE OF state');
    expect(sql).toContain("NEW.state IN ('POSTED', 'PENDING_APPROVAL')");
  });
});
