import { describe, expect, it } from 'vitest';

import { staffCommandIntentForRetention } from './useStaff';

describe('Workforce retained command intent', () => {
  it('never includes PIN or verifier material in the durable idempotency fingerprint', () => {
    const sentinelPin = '482731';
    const intent = staffCommandIntentForRetention({
      type: 'employee.pin',
      employeeId: '11111111-1111-4111-8111-111111111111',
      shopId: '22222222-2222-4222-8222-222222222222',
      newPin: sentinelPin,
      requesterPin: '1234',
      pinVerifierHash: 'pbkdf2-secret',
      pinLookupHash: 'lookup-secret',
      salt: 'salt-secret',
    });

    expect(intent).toEqual({
      type: 'employee.pin',
      employeeId: '11111111-1111-4111-8111-111111111111',
      shopId: '22222222-2222-4222-8222-222222222222',
    });
    expect(JSON.stringify(intent)).not.toContain(sentinelPin);
    expect(JSON.stringify(intent)).not.toContain('pbkdf2-secret');
    expect(JSON.stringify(intent)).not.toContain('lookup-secret');
    expect(JSON.stringify(intent)).not.toContain('salt-secret');
  });
});
