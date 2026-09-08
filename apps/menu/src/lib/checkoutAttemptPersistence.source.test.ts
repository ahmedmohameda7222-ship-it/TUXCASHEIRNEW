import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../components/cart/CartDrawer.tsx', import.meta.url),
  'utf8',
);

describe('Menu checkout idempotency recovery', () => {
  it('persists the pending checkout attempt across reloads and clears it only after success or intentional cart reset', () => {
    expect(source).toContain("from '@/lib/checkout-attempt'");
    expect(source).toContain('loadPendingCheckoutAttempt');
    expect(source).toContain('persistPendingCheckoutAttempt');
    expect(source).toContain('clearPendingCheckoutAttempt');
    expect(source).toMatch(/persistPendingCheckoutAttempt\(attempt\)[\s\S]*?submitOnlineOrder/);
    expect(source).toMatch(
      /setSubmissionStatus\('success'\)[\s\S]*?clearPendingCheckoutAttempt\(\)/,
    );
  });
});
