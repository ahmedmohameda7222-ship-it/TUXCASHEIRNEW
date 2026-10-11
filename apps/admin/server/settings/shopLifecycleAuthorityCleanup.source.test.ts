import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../supabase/migrations',
);

describe('single canonical shop lifecycle authority', () => {
  it('preserves the original RPC and removes an unused parallel overload safely', () => {
    const names = readdirSync(migrationsDir);
    expect(names.some((name) => name.endsWith('_admin_shop_lifecycle_transitions.sql'))).toBe(true);
    const cleanupName = names.find((name) =>
      name.endsWith('_admin_shop_lifecycle_authority_cleanup.sql'),
    );
    expect(cleanupName).toBeDefined();
    const cleanup = readFileSync(join(migrationsDir, cleanupName!), 'utf8');
    expect(cleanup).toContain('TUX_ADMIN_DUPLICATE_LIFECYCLE_AUTHORITY_IN_USE');
    expect(cleanup).toContain('DROP FUNCTION IF EXISTS public.update_admin_shop_lifecycle_v1');
    expect(cleanup).toContain('DROP TABLE public.admin_shop_lifecycle_commands');
    expect(cleanup).toContain('DROP COLUMN lifecycle_edit_version');
    expect(cleanup).not.toContain('DROP COLUMN lifecycle_revision');
  });
});
