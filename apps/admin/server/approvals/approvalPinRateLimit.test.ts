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
  it('claims a bounded attempt before verifying and leaves failed attempts uncleared', async () => {
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
    expect(rpc.claim).toHaveBeenCalledTimes(1);
    expect(verifyEmployeePin).toHaveBeenCalledWith('employee-1', '482731');
    expect(rpc.clear).not.toHaveBeenCalled();
  });

  it('clears the bounded attempt window only after successful PIN verification', async () => {
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
    expect(rpc.claim).toHaveBeenCalledTimes(1);
    expect(rpc.clear).toHaveBeenCalledTimes(1);
  });

  it('blocks verification when the attempt window is exhausted', async () => {
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
});
