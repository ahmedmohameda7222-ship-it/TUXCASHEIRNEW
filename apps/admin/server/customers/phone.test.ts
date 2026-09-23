import { describe, expect, it } from 'vitest';

import { CustomerPhoneError, canonicalizeEgyptPhone } from './phone';

describe('canonicalizeEgyptPhone', () => {
  it.each(['01012345678', '+201012345678', '00201012345678', '201012345678'])(
    'normalizes %s to the business-level E.164 identity',
    (input) => expect(canonicalizeEgyptPhone(input)).toBe('+201012345678'),
  );

  it.each(['', '010123', '01312345678', '+491701234567', '01012345678999'])(
    'rejects malformed or unsupported phone %s without truncation',
    (input) => expect(() => canonicalizeEgyptPhone(input)).toThrow(CustomerPhoneError),
  );
});
