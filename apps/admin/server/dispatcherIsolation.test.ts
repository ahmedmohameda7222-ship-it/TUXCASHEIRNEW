import { describe, expect, it, vi } from 'vitest';

import type { AdminRequest, AdminResponse } from './http.js';

vi.mock('./delivery/deliveryApi.js', () => {
  throw new Error('delivery_module_initialization_failed');
});
vi.mock('./finance/financeApi.js', () => ({
  handleFinanceRequest: async (_request: AdminRequest, response: AdminResponse) => {
    response.statusCode = 204;
    response.end();
  },
}));
vi.mock('./reports/reportApi.js', () => ({
  handleReportsRequest: async (_request: AdminRequest, response: AdminResponse) => {
    response.statusCode = 205;
    response.end();
  },
}));
vi.mock('./customers/customerApi.js', () => ({
  handleCustomersRequest: async (_request: AdminRequest, response: AdminResponse) => {
    response.statusCode = 206;
    response.end();
  },
}));
vi.mock('./customers/crmApi.js', () => ({
  handleCrmRequest: async (_request: AdminRequest, response: AdminResponse) => {
    response.statusCode = 207;
    response.end();
  },
}));
vi.mock('./staff/staffApi.js', () => ({
  handleStaffRequest: async (_request: AdminRequest, response: AdminResponse) => {
    response.statusCode = 208;
    response.end();
  },
}));

describe('consolidated Admin dispatcher module isolation', () => {
  it.each([
    ['finance', 204],
    ['reports', 205],
    ['customers', 206],
    ['staff', 208],
  ])('%s dispatch does not initialize Delivery', async (resource, status) => {
    const { default: handler } = await import('../api/admin/orders.js');
    const response = {
      statusCode: 200,
      setHeader: vi.fn(),
      end: vi.fn(),
    } as unknown as AdminResponse;
    const request = {
      method: 'GET',
      url: `/api/admin/orders?__adminResource=${resource}`,
      headers: {},
    } as unknown as AdminRequest;
    await handler(request, response);
    expect(response.statusCode).toBe(status);
  });
});
