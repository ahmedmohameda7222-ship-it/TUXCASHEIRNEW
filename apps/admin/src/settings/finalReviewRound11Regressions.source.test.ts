import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function sourceOrEmpty(path: string): string {
  try {
    return source(path);
  } catch {
    return '';
  }
}

const reasonCodes = source('./ReasonCodesPage.tsx');
const receipts = source('./ReceiptsPage.tsx');
const migration = sourceOrEmpty(
  '../../../../supabase/migrations/20260910122500_admin_plan2_final_review_round11_hardening.sql',
).toLowerCase();

describe('Plan 2 final review round 11 regressions', () => {
  it('refreshes a pristine reason editor and its CAS token without rebasing dirty edits', () => {
    expect(reasonCodes).toContain("import { useEffect, useState, type FormEvent } from 'react'");
    expect(reasonCodes).toContain(
      'const [expectedVersion, setExpectedVersion] = useState(reason.version)',
    );
    expect(reasonCodes).toContain('const [dirty, setDirty] = useState(false)');
    expect(reasonCodes).toContain('if (dirty) return');
    expect(reasonCodes).toContain('setExpectedVersion(reason.version)');
    expect(reasonCodes).toContain('setDirty(false)');
  });

  it('keeps the receipt sequence editor inside the trusted setting policy range', () => {
    expect(receipts).toContain('const RECEIPT_SEQUENCE_MAX = 2_147_483_647');
    expect(receipts).toContain('max={RECEIPT_SEQUENCE_MAX}');
    expect(receipts).not.toContain('max={Number.MAX_SAFE_INTEGER}');
  });

  it('adds durable remote storage for reconciliation reason-code snapshots', () => {
    expect(migration).toContain('alter table public.reconciliation_lines');
    expect(migration).toContain('variance_reason_code_snapshot jsonb');
  });
});
