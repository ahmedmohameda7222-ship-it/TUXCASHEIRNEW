import { describe, expect, it } from 'vitest';

import { requireSuccessfulCrmMutation } from './crmMutationGuard';

describe('CRM command result guard', () => {
  it('returns a real confirmed server success without modifying the result', () => {
    const accepted = { ok: true, version: 7 };
    expect(requireSuccessfulCrmMutation(accepted)).toBe(accepted);
  });

  it('raises a returned rejection instead of reporting a successful loyalty adjustment', () => {
    expect(() =>
      requireSuccessfulCrmMutation({ ok: false, code: 'loyalty_balance_conflict' }),
    ).toThrow('loyalty_balance_conflict');
  });

  it('never represents a missing confirmation as success', () => {
    expect(() => requireSuccessfulCrmMutation({ ok: false })).toThrow('crm_action_rejected');
  });
});
