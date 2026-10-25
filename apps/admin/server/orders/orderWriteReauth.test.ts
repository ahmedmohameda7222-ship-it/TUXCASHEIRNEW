import { describe, expect, it } from 'vitest';

import { requireOrdersWriteReauthentication } from '../../api/admin/orders';

describe('Orders server-side PIN reauthentication', () => {
  const now = new Date('2026-10-25T12:00:00.000Z');

  it('refuses direct financial mutations without prior PIN verification', () => {
    expect(() => requireOrdersWriteReauthentication(null, now))
      .toThrow('reauthentication_required');
  });

  it('refuses a stale or future-dated step-up', () => {
    expect(() => requireOrdersWriteReauthentication('2026-10-25T11:54:59.000Z', now))
      .toThrow('reauthentication_required');
    expect(() => requireOrdersWriteReauthentication('2026-10-25T12:00:01.000Z', now))
      .toThrow('reauthentication_required');
  });

  it('accepts a recently verified PIN within five minutes', () => {
    expect(() => requireOrdersWriteReauthentication('2026-10-25T11:59:00.000Z', now))
      .not.toThrow();
  });
});
