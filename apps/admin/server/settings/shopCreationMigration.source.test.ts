import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../supabase/migrations',
);

describe('canonical authorized shop creation', () => {
  it('atomically creates a business-bound shop with idempotency, audit, and closed intake', () => {
    const files = readdirSync(migrationsDir).filter((name) =>
      name.endsWith('_admin_shop_creation.sql'),
    );
    expect(files).toHaveLength(1);
    const sql = readFileSync(join(migrationsDir, files[0]!), 'utf8');
    expect(sql).toContain('private.assert_admin_business_settings_permission_v1');
    expect(sql).toContain("'shops.manage'");
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain('admin_shop_create_commands');
    expect(sql).toContain('INSERT INTO public.shops');
    expect(sql).toContain('INSERT INTO public.business_shops');
    expect(sql).toContain("'Africa/Cairo'");
    expect(sql).toContain('temporary_closed');
    expect(sql).toContain('online_orders_paused');
    expect(sql).toContain('append_admin_audit_event_v1');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.create_admin_shop_v1');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.create_admin_shop_v1');
    expect(sql).not.toContain('INSERT INTO public.orders');
    expect(sql).not.toContain('INSERT INTO public.inventory_items');
    expect(sql).not.toContain('INSERT INTO public.catalog_drafts');
  });
});
