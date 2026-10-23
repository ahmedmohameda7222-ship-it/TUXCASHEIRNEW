import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handleOperationsHealthRequest = vi.fn(async () => undefined);
vi.mock('../operations/operationsHealthApi.js', () => ({ handleOperationsHealthRequest }));

import handler from '../../api/admin/orders';

describe('Admin consolidated operations health dispatch', () => {
  beforeEach(() => handleOperationsHealthRequest.mockClear());

  it('removes the internal routing marker before invoking the health handler', async () => {
    const request = Object.assign(new EventEmitter(), {
      method: 'GET',
      url: '/api/admin/orders?__adminResource=operations-health&view=summary&shopId=11111111-1111-4111-8111-111111111111',
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
    });
    const response = { setHeader: vi.fn(), end: vi.fn(), statusCode: 200 };
    await handler(request as never, response as never);
    expect(handleOperationsHealthRequest).toHaveBeenCalledOnce();
    expect(request.url).toBe(
      '/api/admin/orders?view=summary&shopId=11111111-1111-4111-8111-111111111111',
    );
  });
});
