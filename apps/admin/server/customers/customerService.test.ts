import { describe, expect, it, vi } from 'vitest';

import type { AdminSessionPrincipal } from '@tux/admin-contracts';
import {
  CustomerServiceError,
  createCustomerService,
  type CustomerStore,
} from './customerService';

const businessId = '10000000-0000-4000-8000-000000000001';
const employeeId = '20000000-0000-4000-8000-000000000001';
const survivorCustomerId = '30000000-0000-4000-8000-000000000001';
const mergedCustomerId = '30000000-0000-4000-8000-000000000002';

function principal(
  permissions: AdminSessionPrincipal['permissions'] = [
    'customers.view',
    'customers.manage',
    'customers.merge',
  ],
  role: AdminSessionPrincipal['role'] = 'OWNER',
): AdminSessionPrincipal {
  return {
    employeeId,
    businessId,
    role,
    permissions,
    shopIds: ['40000000-0000-4000-8000-000000000001'],
  };
}

function storeFixture(): CustomerStore {
  return {
    findByNormalizedPhone: vi.fn(async ({ normalizedPhone }) =>
      normalizedPhone === '+201012345678'
        ? {
            id: survivorCustomerId,
            businessId,
            normalizedPhone,
            displayName: 'Mona',
            mergedIntoCustomerId: null,
          }
        : null,
    ),
    mergeCustomers: vi.fn(async (input) => ({
      ok: true,
      survivorCustomerId: input.survivorCustomerId,
      mergedCustomerId: input.mergedCustomerId,
      replayed: false,
    })),
  };
}

describe('canonical customer service', () => {
  it('resolves identity by canonical phone, never by same name alone', async () => {
    const store = storeFixture();
    const service = createCustomerService(store);

    await expect(
      service.findByPhone({ phone: '01012345678' }, principal(['customers.view'])),
    ).resolves.toMatchObject({
      id: survivorCustomerId,
      normalizedPhone: '+201012345678',
      displayName: 'Mona',
    });

    await expect(
      service.findByPhone({ phone: '01112345678' }, principal(['customers.view'])),
    ).resolves.toBeNull();

    expect(store.findByNormalizedPhone).toHaveBeenNthCalledWith(1, {
      businessId,
      normalizedPhone: '+201012345678',
    });
    expect(store.findByNormalizedPhone).toHaveBeenNthCalledWith(2, {
      businessId,
      normalizedPhone: '+201112345678',
    });
  });

  it('requires business-wide customers.merge authority and explicit confirmation', async () => {
    const store = storeFixture();
    const service = createCustomerService(store);
    const input = {
      survivorCustomerId,
      mergedCustomerId,
      confirmed: true as const,
      commandId: 'merge-customer-1',
    };

    expect(() =>
      service.mergeCustomers(input, principal(['customers.view'], 'MANAGER')),
    ).toThrow(/permission_forbidden/);

    await expect(
      service.mergeCustomers({ ...input, confirmed: false }, principal()),
    ).rejects.toBeInstanceOf(CustomerServiceError);

    await expect(service.mergeCustomers(input, principal())).resolves.toMatchObject({
      ok: true,
      survivorCustomerId,
      mergedCustomerId,
    });

    expect(store.mergeCustomers).toHaveBeenCalledWith({
      ...input,
      employeeId,
      businessId,
    });
  });

  it('rejects a self-merge before calling the canonical store', async () => {
    const store = storeFixture();
    const service = createCustomerService(store);

    await expect(
      service.mergeCustomers(
        {
          survivorCustomerId,
          mergedCustomerId: survivorCustomerId,
          confirmed: true,
          commandId: 'merge-self',
        },
        principal(),
      ),
    ).rejects.toMatchObject({ code: 'customer_merge_same_identity' });

    expect(store.mergeCustomers).not.toHaveBeenCalled();
  });
});
