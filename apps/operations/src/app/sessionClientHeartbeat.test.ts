import { describe, expect, it, vi } from 'vitest';
import { deliverWorkerSessionOriginBeforeHeartbeat } from './sessionClient';

describe('browser worker-session heartbeat ordering', () => {
  it('does not touch canonical session authority while its origin events are still pending', async () => {
    const order: string[] = [];
    const touchWorkerSession = vi.fn(async () => order.push('touch'));

    await deliverWorkerSessionOriginBeforeHeartbeat({
      flushShopOutbox: async () => order.push('flush'),
      hasPendingSessionOrigin: async () => {
        order.push('inspect');
        return true;
      },
      touchWorkerSession,
    });

    expect(order).toEqual(['flush', 'inspect']);
    expect(touchWorkerSession).not.toHaveBeenCalled();
  });

  it('touches canonical session authority only after its origin events are delivered', async () => {
    const order: string[] = [];

    await deliverWorkerSessionOriginBeforeHeartbeat({
      flushShopOutbox: async () => order.push('flush'),
      hasPendingSessionOrigin: async () => {
        order.push('inspect');
        return false;
      },
      touchWorkerSession: async () => {
        order.push('touch');
      },
    });

    expect(order).toEqual(['flush', 'inspect', 'touch']);
  });
});
