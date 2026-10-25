import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Source guard only. An isolated PostgreSQL concurrency test remains required. */
const migration = () =>
  readFileSync(
    resolve('supabase/migrations/20261025160000_admin_paid_active_cancellation_guard.sql'),
    'utf8',
  );

describe('P1 paid ACTIVE cancellation financial safety', () => {
  it('checks recorded payments while the canonical order row is locked, before releasing stock or changing status', () => {
    const sql = migration().toLowerCase();
    const orderLock = sql.indexOf('for update;');
    const paymentGuard = sql.indexOf('paid_active_order_requires_settlement');
    const reservationRelease = sql.indexOf("'order_reservation_release'");
    const statusUpdate = sql.indexOf("set status = 'cancelled'");
    expect(orderLock).toBeGreaterThan(-1);
    expect(paymentGuard).toBeGreaterThan(orderLock);
    expect(reservationRelease).toBeGreaterThan(paymentGuard);
    expect(statusUpdate).toBeGreaterThan(paymentGuard);
    expect(sql).toContain('from public.payments');
    expect(sql).toContain('allocated_minor > 0');
  });

  it('preserves cancellation RPC authorization, idempotency and service-role-only access', () => {
    const sql = migration().toLowerCase();
    expect(sql).toContain('private.admin_order_authority_v1');
    expect(sql).toContain('admin_order_command_receipts');
    expect(sql).toContain('request_fingerprint');
    expect(sql).toContain('revoke all on function public.cancel_admin_order_v1');
    expect(sql).toContain('grant execute on function public.cancel_admin_order_v1');
    expect(sql).toContain('to service_role');
  });
});
