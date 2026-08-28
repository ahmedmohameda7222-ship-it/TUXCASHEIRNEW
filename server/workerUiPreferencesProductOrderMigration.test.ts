import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260828060000_worker_ui_preferences_product_order.sql',
);

describe('worker UI preference product-order migration', () => {
  it('adds worker-scoped product ordering and upgrades the monotonic RPC contract', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain("add column if not exists product_order jsonb not null default '[]'::jsonb");
    expect(sql).toContain('p_product_order jsonb');
    expect(sql).toContain("jsonb_typeof(p_product_order) <> 'array'");
    expect(sql).toContain('product_order = excluded.product_order');
    expect(sql).toContain('preferences.product_order');
    expect(sql).toContain(
      'grant execute on function public.put_worker_ui_preferences(uuid, uuid, jsonb, text, jsonb)',
    );
  });
});
