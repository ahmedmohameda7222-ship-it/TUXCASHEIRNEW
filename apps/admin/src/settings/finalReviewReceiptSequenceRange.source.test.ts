import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('Plan 2 receipt sequence storage range', () => {
  it('caps receipt.sequenceStart to the PostgreSQL int4 range at the BFF boundary', () => {
    const settingsApi = source('../../api/admin/settings.ts');

    expect(settingsApi).toContain('const POSTGRES_INTEGER_MAX = 2_147_483_647');
    expect(settingsApi).toMatch(
      /'receipt\.sequenceStart':\s*z\.number\(\)\.int\(\)\.positive\(\)\.max\(POSTGRES_INTEGER_MAX\)/,
    );
  });

  it('hardens the trusted SQL validator with an additive migration', () => {
    const migration = source(
      '../../../../supabase/migrations/20260910121400_admin_receipt_sequence_range_hardening.sql',
    );

    expect(migration).toContain("when 'receipt.sequenceStart' then");
    expect(migration).toMatch(/between\s+1\s+and\s+2147483647/i);
    expect(migration).toContain('create or replace function private.validate_admin_setting_value_v1');
  });
});
