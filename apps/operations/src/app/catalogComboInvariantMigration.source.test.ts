import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationSource = readFileSync(
  new URL(
    '../../../../supabase/migrations/20260908058000_catalog_combo_mode_invariant.sql',
    import.meta.url,
  ),
  'utf8',
);
const adminSource = readFileSync(
  new URL('../../../../supabase/functions/catalog-admin/catalogAdmin.ts', import.meta.url),
  'utf8',
);
const storeSource = readFileSync(
  new URL('../../../../supabase/functions/catalog-admin/index.ts', import.meta.url),
  'utf8',
);

describe('catalog combo admin invariant', () => {
  it('blocks disabling combo mode while beverage-option rows still exist', () => {
    expect(migrationSource).toContain('before update of is_combo on public.products');
    expect(migrationSource).toContain('public.combo_beverage_options');
    expect(migrationSource).toContain('TUX_COMBO_BEVERAGE_OPTIONS_REQUIRE_COMBO_PRODUCT');
  });

  it('reports the blocked admin transition as a command conflict', () => {
    expect(adminSource).toContain('command.patch.isCombo === false');
    expect(adminSource).toContain('store.hasComboBeverageOptions');
    expect(adminSource).toContain("return 'command_conflict'");
    expect(storeSource).toContain(".from('combo_beverage_options')");
    expect(storeSource).toContain(".eq('combo_product_id', productId)");
  });
});
