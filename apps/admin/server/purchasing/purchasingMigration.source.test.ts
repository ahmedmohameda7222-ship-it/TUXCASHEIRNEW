import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('create_purchase_order_v1 source contract', () => {
  it('rejects duplicate inventory items before inserting the purchase-order header', () => {
    const sql = readFileSync(
      new URL(
        '../../../../supabase/migrations/20260910150000_admin_purchasing.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const start = sql.indexOf('create or replace function public.create_purchase_order_v1');
    const end = sql.indexOf('create or replace function public.update_purchase_order_v1', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const fn = sql.slice(start, end);
    const duplicateGuard = fn.indexOf("'duplicate_inventory_item'");
    const headerInsert = fn.indexOf('insert into public.purchase_orders');

    expect(duplicateGuard).toBeGreaterThanOrEqual(0);
    expect(duplicateGuard).toBeLessThan(headerInsert);
  });
});
