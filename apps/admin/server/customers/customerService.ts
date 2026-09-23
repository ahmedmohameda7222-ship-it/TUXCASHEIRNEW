import type {
  AdminCustomerIdentity,
  AdminCustomerMergeInput,
  AdminCustomerMergeResult,
  AdminSessionPrincipal,
} from '@tux/admin-contracts';

import { requireBusinessWidePermission, requirePermission } from '../authorization.js';
import { canonicalizeEgyptPhone } from './phone.js';

export class CustomerServiceError extends Error {
  constructor(
    readonly code:
      | 'customer_merge_confirmation_required'
      | 'customer_merge_same_identity',
  ) {
    super(code);
    this.name = 'CustomerServiceError';
  }
}

export interface CustomerStore {
  findByNormalizedPhone(input: {
    businessId: string;
    shopId: string;
    normalizedPhone: string;
  }): Promise<AdminCustomerIdentity | null>;
  mergeCustomers(
    input: AdminCustomerMergeInput & {
      employeeId: string;
      businessId: string;
    },
  ): Promise<AdminCustomerMergeResult>;
}

export function createCustomerService(store: CustomerStore) {
  return {
    findByPhone(
      input: { shopId: string; phone: string },
      principal: AdminSessionPrincipal,
    ): Promise<AdminCustomerIdentity | null> {
      requirePermission(principal, 'customers.view', input.shopId);
      return store.findByNormalizedPhone({
        businessId: principal.businessId,
        shopId: input.shopId,
        normalizedPhone: canonicalizeEgyptPhone(input.phone),
      });
    },

    mergeCustomers(
      input: AdminCustomerMergeInput,
      principal: AdminSessionPrincipal,
    ): Promise<AdminCustomerMergeResult> {
      requireBusinessWidePermission(principal, 'customers.merge');

      if (!input.confirmed) {
        return Promise.reject(
          new CustomerServiceError('customer_merge_confirmation_required'),
        );
      }
      if (input.survivorCustomerId === input.mergedCustomerId) {
        return Promise.reject(new CustomerServiceError('customer_merge_same_identity'));
      }

      return store.mergeCustomers({
        ...input,
        employeeId: principal.employeeId,
        businessId: principal.businessId,
      });
    },
  };
}
