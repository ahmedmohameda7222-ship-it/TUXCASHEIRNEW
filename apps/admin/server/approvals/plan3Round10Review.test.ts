import type { AdminSessionPrincipal } from '@tux/admin-contracts';
import { describe, expect, it, vi } from 'vitest';

import type { AdminSupabaseClient } from '../supabaseAdmin';
import * as approvalReadModule from './approvalReadService';

const principal: AdminSessionPrincipal = {
  employeeId: 'approver-1',
  businessId: 'business-1',
  role: 'OWNER',
  permissions: ['approvals.review'],
  shopIds: ['11111111-1111-4111-8111-111111111111'],
};

function requestRow(index: number) {
  const createdAt = new Date(Date.UTC(2026, 8, 18, 0, 0, 0) - index * 1_000).toISOString();
  return {
    id: `approval-${String(index).padStart(3, '0')}`,
    business_id: principal.businessId,
    shop_id: principal.shopIds[0],
    requester_employee_id: 'requester-1',
    approver_employee_id: null,
    action_type: 'INVENTORY_ADJUSTMENT',
    command_payload: { quantityImpact: -1 },
    reason: 'Cycle count mismatch',
    required_approver_permission: 'inventory.adjust',
    requires_second_person: true,
    status: 'PENDING',
    expires_at: '2099-01-01T00:00:00.000Z',
    created_at: createdAt,
    decided_at: null,
    executed_at: null,
    failed_at: null,
  } as const;
}

function pageReader() {
  return (approvalReadModule as Record<string, unknown>)['listApprovalReadPage'];
}

describe('Plan 3 round 10 review regressions', () => {
  it('returns a continuation cursor and applies it before the next bounded approval page', async () => {
    const listPage = pageReader();
    expect(typeof listPage).toBe('function');
    if (typeof listPage !== 'function') return;

    const rows = Array.from({ length: 101 }, (_, index) => requestRow(index));
    const select = vi.fn(async (table: string) => {
      if (table === 'admin_approval_requests') return rows;
      if (table === 'business_employees') {
        return [{ id: 'requester-1', display_name: 'Requester One' }];
      }
      if (table === 'shops') return [{ id: principal.shopIds[0], name: 'TUX' }];
      if (table === 'admin_approval_execution_jobs') return [];
      throw new Error(`unexpected table ${table}`);
    });
    const client = { select } as unknown as AdminSupabaseClient;

    const first = (await listPage(client, principal)) as {
      approvals: readonly { id: string }[];
      nextCursor: { createdAt: string; id: string } | null;
    };

    const firstApprovalCall = select.mock.calls.find(
      ([table]) => table === 'admin_approval_requests',
    );
    expect(firstApprovalCall?.[1]).toBeInstanceOf(URLSearchParams);
    expect((firstApprovalCall?.[1] as URLSearchParams | undefined)?.get('limit')).toBe('101');
    expect(first.approvals).toHaveLength(100);
    expect(first.nextCursor).toEqual({
      createdAt: rows[99]?.created_at,
      id: rows[99]?.id,
    });

    select.mockClear();
    await listPage(client, principal, { cursor: first.nextCursor });
    const secondApprovalCall = select.mock.calls.find(
      ([table]) => table === 'admin_approval_requests',
    );
    const nextQuery = secondApprovalCall?.[1] as URLSearchParams | undefined;
    expect(nextQuery?.get('or')).toContain(`created_at.lt.${first.nextCursor?.createdAt}`);
    expect(nextQuery?.get('or')).toContain(`id.lt.${first.nextCursor?.id}`);
  });

  it('preserves ADMIN assigned-shop plus business-wide scope when applying a cursor', async () => {
    const listPage = pageReader();
    expect(typeof listPage).toBe('function');
    if (typeof listPage !== 'function') return;

    const admin: AdminSessionPrincipal = { ...principal, role: 'ADMIN' };
    const row = requestRow(0);
    const select = vi.fn(async (table: string) => {
      if (table === 'admin_approval_requests') return [row];
      if (table === 'business_employees') {
        return [{ id: 'requester-1', display_name: 'Requester One' }];
      }
      if (table === 'shops') return [{ id: principal.shopIds[0], name: 'TUX' }];
      if (table === 'admin_approval_execution_jobs') return [];
      throw new Error(`unexpected table ${table}`);
    });
    const client = { select } as unknown as AdminSupabaseClient;

    await listPage(client, admin, {
      cursor: { createdAt: '2026-09-18T00:00:00.000Z', id: 'approval-099' },
    });

    const approvalCall = select.mock.calls.find(([table]) => table === 'admin_approval_requests');
    const query = approvalCall?.[1] as URLSearchParams | undefined;
    const combined = query?.get('and') ?? '';
    expect(combined).toContain('shop_id.is.null');
    expect(combined).toContain(`shop_id.in.(${admin.shopIds[0]})`);
    expect(combined).toContain('created_at.lt.2026-09-18T00:00:00.000Z');
    expect(combined).toContain('id.lt.approval-099');
  });
});
