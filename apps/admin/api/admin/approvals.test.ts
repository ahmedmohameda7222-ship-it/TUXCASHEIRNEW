import type { AdminSessionContext } from '../../server/adminAuthService';
import { describe, expect, it } from 'vitest';

import {
  buildApprovalActor,
  parseApprovalDecisionBody,
  requireApprovalEndpointAccess,
} from './approvals';

function context(
  permissions: AdminSessionContext['principal']['permissions'],
): AdminSessionContext {
  return {
    session: {
      id: 'session-1',
      business_id: 'business-1',
      employee_id: 'employee-1',
      csrf_token_hash: 'csrf',
      expires_at: '2099-01-01T00:00:00.000Z',
      revoked_at: null,
      reauthenticated_at: null,
    },
    employee: {
      id: 'employee-1',
      business_id: 'business-1',
      display_name: 'Approver',
      role: 'MANAGER',
      pin_hash: null,
      active: true,
    },
    principal: {
      employeeId: 'employee-1',
      businessId: 'business-1',
      role: 'MANAGER',
      permissions,
      shopIds: ['11111111-1111-4111-8111-111111111111'],
    },
  };
}

describe('Admin approvals BFF boundary', () => {
  it('requires approvals.review before any approvals endpoint access', () => {
    expect(() => requireApprovalEndpointAccess(context([]))).toThrowError('permission_forbidden');
  });

  it('enforces shop scope before listing a concrete shop', () => {
    expect(() =>
      requireApprovalEndpointAccess(
        context(['approvals.review']),
        '22222222-2222-4222-8222-222222222222',
      ),
    ).toThrowError('shop_forbidden');
  });

  it('builds the approval actor from the trusted server session, not browser input', () => {
    expect(buildApprovalActor(context(['approvals.review']))).toMatchObject({
      employeeId: 'employee-1',
      businessId: 'business-1',
      sessionId: 'session-1',
      role: 'MANAGER',
    });
  });

  it('fails closed when a decision omits the approver PIN', () => {
    expect(
      parseApprovalDecisionBody({
        requestId: '11111111-1111-4111-8111-111111111111',
        decision: 'APPROVE',
      }),
    ).toBeNull();
  });
});
