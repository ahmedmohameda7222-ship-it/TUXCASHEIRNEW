import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../supabase/migrations',
);
const migration = join(migrationsDir, '20261011215542_admin_suspended_shop_intake_guard.sql');

describe('suspended shop intake integrity', () => {
  it('rejects suspended intake from every writer', () => {
    const sql = readFileSync(migration, 'utf8');
    expect(sql).toContain('ADD CONSTRAINT shops_suspended_intake_closed_ck');
    expect(sql).toContain("lifecycle_state <> 'SUSPENDED'");
    expect(sql).toContain('NOT active AND temporary_closed AND online_orders_paused');
  });
});
