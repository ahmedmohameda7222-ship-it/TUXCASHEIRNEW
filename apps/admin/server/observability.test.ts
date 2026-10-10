import { describe, expect, it } from 'vitest';

import { adminRequestOperation } from './observability.js';
import type { AdminRequest } from './http.js';

function request(method: string, url: string): AdminRequest {
  return { method, url, headers: {} } as AdminRequest;
}

describe('sanitized Admin backend operation context', () => {
  it('distinguishes permitted GET views without logging query secrets', () => {
    expect(adminRequestOperation(request('GET', '/api/admin/finance?view=day&token=secret'))).toBe(
      'day',
    );
    expect(
      adminRequestOperation(request('GET', '/api/admin/inventory?shopId=abc&inventoryItemId=xyz')),
    ).toBe('item-history');
    expect(adminRequestOperation(request('GET', '/api/admin/reports'))).toBe('workspace');
  });

  it('never logs client-controlled arbitrary view values or mutation payloads', () => {
    expect(adminRequestOperation(request('POST', '/api/admin/finance?view=secret'))).toBe(
      'command',
    );
    expect(adminRequestOperation(request('GET', '/api/admin/reports?view=api_key%3Dabc'))).toBe(
      'workspace',
    );
    expect(adminRequestOperation(request('GET', '/api/admin/reports?view=%0Aprivate'))).toBe(
      'workspace',
    );
  });
});
