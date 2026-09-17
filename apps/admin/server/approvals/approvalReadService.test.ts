import type { AdminSessionPrincipal } from '@tux/admin-contracts';
import { describe, expect, it, vi } from 'vitest';

import type { AdminSupabaseClient } from '../supabaseAdmin';
import { listApprovalReadModels } from './approvalReadService';

const principal: AdminSessionPrincipal = {
  employeeId: 'approver-1',
  businessId: 'business-1',
  role: 'MANAGER',
  permissions: ['approvals.review'],
  shopIds: ['11111111-1111-4111-8111-111111111111'],
};

function clientWithRequest() {
  const select = vi.fn(async (table: string) => {
    if (table === 'admin_approval_requests') {
      return [
        {
          id: '22222222-2222-4222-8222-222222222222',
          business_id: principal.businessId,
          shop_id: principal.shopIds[0],
          requester_employee_id: 'requester-1',
          approver_employee_id: null,
          action_type: 'STAFF_ROLE_CHANGE',
          command_payload: { employeeId: 'employee-2', role: 'ADMIN' },
          reason: 'promotion',
          status: 'PENDING',
          created_at: '2026-09-16T12:00:00.000Z',
          decided_at: null,
          executed_at: null,
          failed_at: null,
        },
      ];
    }
    if (table === 'business_employees') {
      return [{ id: 'requester-1', display_name: 'Requester One' }];
    }
    if (table === 'shops') {
      return [{ id: principal.shopIds[0], name: 'TUX' }];
    }
    if (table === 'admin_approval_execution_jobs') return [];
    throw new Error(`unexpected table ${table}`);
  });
  return { client: { select } as unknown as AdminSupabaseClient, select };
}

describe('approvalReadService', () => {
  it('shows every material persisted command field to the reviewer', async () => {
    const { client } = clientWithRequest();

    const [model] = await listApprovalReadModels(client, principal);

    expect(model?.valueSummary).toContain('employeeId');
    expect(model?.valueSummary).toContain('employee-2');
    expect(model?.valueSummary).toContain('role');
    expect(model?.valueSummary).toContain('ADMIN');
  });

  it('pushes the reviewer shop scope into the approval query before its limit', async () => {
    const { client, select } = clientWithRequest();

    await listApprovalReadModels(client, principal);

    const approvalCall = select.mock.calls.find(([table]) => table === 'admin_approval_requests');
    const query = approvalCall?.[1];
    expect(query).toBeInstanceOf(URLSearchParams);
    expect(query?.get('shop_id')).toBe(`in.(${principal.shopIds[0]})`);
    expect(query?.get('limit')).toBe('100');
  });
});
