import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationUrl = new URL(
  '../../../supabase/migrations/20260910121300_admin_plan2_safe_price_hardening.sql',
  import.meta.url,
);

describe('catalog JavaScript-safe price boundary', () => {
  it('hardens the trusted catalog draft boundary to Number.MAX_SAFE_INTEGER', () => {
    const sql = readFileSync(migrationUrl, 'utf8').toLowerCase();
    expect(sql).toContain('9007199254740991');
    expect(sql).toContain('validate_admin_catalog_safe_prices_v1');
    expect(sql).toContain('merge_catalog_owned_draft_bundle_v1');
  });
});
