import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL(
    '../../../../supabase/migrations/20260907202000_catalog_admin_commands.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('catalog combo admin invariant', () => {
  it('refuses disabling combo mode while beverage-option rows still exist', () => {
    const productUpdateStart = source.indexOf("elsif v_type = 'product.update' then");
    const productRetireStart = source.indexOf("elsif v_type = 'product.retire' then");
    expect(productUpdateStart).toBeGreaterThanOrEqual(0);
    expect(productRetireStart).toBeGreaterThan(productUpdateStart);

    const productUpdateBranch = source.slice(productUpdateStart, productRetireStart);
    expect(productUpdateBranch).toContain('combo_beverage_options');
    expect(productUpdateBranch).toContain("jsonb_build_object('errorCode', 'command_conflict')");
  });
});
