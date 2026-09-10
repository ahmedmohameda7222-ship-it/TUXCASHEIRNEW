import { describe, expect, it } from 'vitest';

import {
  AdminRateLimitError,
  claimAdminPinAttempt,
  deriveAdminRateKey,
} from './loginRateLimit';

describe('Admin login rate limiting', () => {
  it('derives a privacy-safe HMAC client key instead of persisting raw client metadata', async () => {
    const input = { ip: '203.0.113.9', userAgent: 'TUX Admin Test Browser' };
    const key = await deriveAdminRateKey(input, 'server-rate-limit-secret');

    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain(input.ip);
    expect(key).not.toContain(input.userAgent);
    expect(await deriveAdminRateKey(input, 'server-rate-limit-secret')).toBe(key);
  });

  it('surfaces a stable 429-compatible error and retry-after when the DB budget is exhausted', async () => {
    const rpc = {
      claim: async () => ({ allowed: false, retryAfterSeconds: 217 }),
    };

    await expect(claimAdminPinAttempt('a'.repeat(64), rpc)).rejects.toMatchObject({
      code: 'too_many_pin_attempts',
      retryAfterSeconds: 217,
    });
  });

  it('accepts an allowed database claim', async () => {
    const rpc = {
      claim: async () => ({ allowed: true, retryAfterSeconds: 0 }),
    };

    await expect(claimAdminPinAttempt('b'.repeat(64), rpc)).resolves.toBeUndefined();
  });

  it('uses a typed rate-limit error', () => {
    const error = new AdminRateLimitError(42);
    expect(error.code).toBe('too_many_pin_attempts');
    expect(error.retryAfterSeconds).toBe(42);
  });
});
