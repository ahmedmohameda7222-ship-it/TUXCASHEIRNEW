import { describe, expect, it, vi } from 'vitest';

import type { AdminPinRateLimitRpc } from '../loginRateLimit';
import { verifyApprovalPinWithRateLimit } from './approvalPinRateLimit';

const fingerprint = { ip: '203.0.113.10', userAgent: 'Plan3 test browser' };
const secret = 'plan3-test-rate-limit-secret';

function limiter(allowed = true): AdminPinRateLimitRpc {
  return {
    claim: vi.fn(async () => ({ allowed, retryAfterSeconds: allowed ? 0 : 900 })),
    clear: vi.fn(async () => undefined),
  };
}

describe('approval PIN rate limiting', () => {
  it('claims bounded stable and client attempts before verifying and leaves failures uncleared', async () => {
    const rpc = limiter();
    const verifyEmployeePin = vi.fn(async () => false);

    const valid = await verifyApprovalPinWithRateLimit(
      {
        employeeId: 'employee-1',
        sessionId: 'session-1',
        pin: '482731',
        fingerprint,
        rateLimitSecret: secret,
      },
      { verifyEmployeePin, limiter: rpc },
    );

    expect(valid).toBe(false);
    expect(rpc.claim).toHaveBeenCalledTimes(2);
    expect(verifyEmployeePin).toHaveBeenCalledWith('employee-1', '482731');
    expect(rpc.clear).not.toHaveBeenCalled();
  });

  it('clears both bounded attempt windows only after successful PIN verification', async () => {
    const rpc = limiter();
    const verifyEmployeePin = vi.fn(async () => true);

    const valid = await verifyApprovalPinWithRateLimit(
      {
        employeeId: 'employee-1',
        sessionId: 'session-1',
        pin: '482731',
        fingerprint,
        rateLimitSecret: secret,
      },
      { verifyEmployeePin, limiter: rpc },
    );

    expect(valid).toBe(true);
    expect(rpc.claim).toHaveBeenCalledTimes(2);
    expect(rpc.clear).toHaveBeenCalledTimes(2);
  });

  it('blocks verification when the stable attempt window is exhausted', async () => {
    const rpc = limiter(false);
    const verifyEmployeePin = vi.fn(async () => true);

    await expect(
      verifyApprovalPinWithRateLimit(
        {
          employeeId: 'employee-1',
          sessionId: 'session-1',
          pin: '482731',
          fingerprint,
          rateLimitSecret: secret,
        },
        { verifyEmployeePin, limiter: rpc },
      ),
    ).rejects.toMatchObject({ code: 'too_many_pin_attempts', retryAfterSeconds: 900 });

    expect(verifyEmployeePin).not.toHaveBeenCalled();
  });

  it('keeps a non-rotatable employee-session bucket when User-Agent changes', async () => {
    const rpc = limiter();
    const verifyEmployeePin = vi.fn(async () => false);

    for (const userAgent of ['attacker-agent-a', 'attacker-agent-b']) {
      await verifyApprovalPinWithRateLimit(
        {
          employeeId: 'employee-1',
          sessionId: 'session-1',
          pin: '000000',
          fingerprint: { ...fingerprint, userAgent },
          rateLimitSecret: secret,
        },
        { verifyEmployeePin, limiter: rpc },
      );
    }

    const rateKeys = vi.mocked(rpc.claim).mock.calls.map(([rateKey]) => rateKey);
    expect(rateKeys).toHaveLength(4);
    expect(new Set(rateKeys).size).toBe(3);
    expect(rateKeys.filter((key) => key === rateKeys[0])).toHaveLength(2);
  });
});
