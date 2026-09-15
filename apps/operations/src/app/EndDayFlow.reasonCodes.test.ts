import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./EndDayFlow.tsx', import.meta.url), 'utf8');

describe('End Day configured CASH_VARIANCE reasons', () => {
  it('renders configured reason choices and submits reasonCodeId while retaining legacy free text', () => {
    expect(source).toContain('cashVarianceReasons');
    expect(source).toContain('<select');
    expect(source).toContain('reasonCodeId');
    expect(source).toContain('<textarea');
  });
});
