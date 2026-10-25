import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { classifyPaidOrderCancellationDatabaseError } from '../../api/admin/orders';

/** Source assertions; the PostgreSQL fixture must separately exercise the trigger. */
const migration = () =>
  readFileSync(
    resolve('supabase/migrations/20261025150000_orders_paid_cancel_safety.sql'),
    'utf8',
  ).toLowerCase();

describe('P1 paid ACTIVE cancellation financial safety', () => {
  it('rejects allocated payment cancellation inside the canonical order update transaction', () => {
    const sql = migration();
    expect(sql).toContain("old.status = 'active'");
    expect(sql).toContain("new.status = 'cancelled'");
    expect(sql).toContain('new.cancelled_by_admin_employee_id is not null');
    expect(sql).toContain('from public.payments');
    expect(sql).toContain('p.allocated_minor > 0');
    expect(sql).toMatch(
      /create trigger orders_paid_admin_cancel_guard\s+before update of status on public.orders/,
    );
    expect(sql).toContain('tux_admin_paid_cancel_requires_settlement');
  });

  it('does not expose a direct client-callable bypass', () => {
    const sql = migration();
    expect(sql).toContain('security definer');
    expect(sql).toContain('set search_path = pg_catalog, public, private');
    expect(sql).toContain('revoke all on function private.reject_paid_active_admin_cancellation_v1');
    expect(sql).toContain('from public, anon, authenticated, service_role');
  });

  it('classifies the database denial as HTTP 409 and never as a successful cancellation', () => {
    expect(
      classifyPaidOrderCancellationDatabaseError(
        '{"message":"TUX_ADMIN_PAID_CANCEL_REQUIRES_SETTLEMENT"}',
      ),
    ).toEqual({ status: 409, error: 'paid_active_cancellation_requires_settlement' });
    expect(classifyPaidOrderCancellationDatabaseError('unrelated failure')).toBeNull();
  });
});
