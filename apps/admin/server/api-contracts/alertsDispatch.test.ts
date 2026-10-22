import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handleAlertsRequest = vi.fn(async () => undefined);

vi.mock('../alerts/alertsApi.js', () => ({ handleAlertsRequest }));

import handler from '../../api/admin/orders';

describe('Admin consolidated alerts dispatch', () => {
  beforeEach(() => handleAlertsRequest.mockClear());

  it('removes the internal routing marker before invoking the alerts handler', async () => {
    const request = Object.assign(new EventEmitter(), {
      method: 'GET',
      url: '/api/admin/orders?__adminResource=alerts&shopId=11111111-1111-4111-8111-111111111111',
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
    });
    const response = {
      setHeader: vi.fn(),
      end: vi.fn(),
      statusCode: 200,
    };

    await handler(request as never, response as never);

    expect(handleAlertsRequest).toHaveBeenCalledOnce();
    expect(request.url).toBe('/api/admin/orders?shopId=11111111-1111-4111-8111-111111111111');
  });
});
