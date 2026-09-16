import type { AdminSessionPrincipal } from '@tux/admin-contracts';
import { describe, expect, it, vi } from 'vitest';

import type { AdminSupabaseClient } from '../supabaseAdmin';
import { listAuditReadModels, type AuditReadFilters } from './auditReadService';

const principal: AdminSessionPrincipal = {
  employeeId: '11111111-1111-4111-8111-111111111111',
  businessId: '22222222-2222-4222-8222-222222222222',
  role: 'OWNER',
  permissions: ['audit.view'],
  shopIds: ['33333333-3333-4333-8333-333333333333'],
};

function createClient(): AdminSupabaseClient {
  return {
    select: vi.fn(async (table: string) => {
      if (table === 'admin_audit_events') {
        return [
          {
            id: '44444444-4444-4444-8444-444444444444',
            business_id: principal.businessId,
            shop_id: principal.shopIds[0],
            actor_kind: 'HUMAN',
            actor_employee_id: principal.employeeId,
            actor_role: 'OWNER',
            action_type: 'APPROVAL_APPROVED',
            entity_type: 'APPROVAL_REQUEST',
            entity_id: '55555555-5555-4555-8555-555555555555',
            before_value: { status: 'PENDING' },
            after_value: { status: 'APPROVED' },
            reason: 'Reviewed',
            approval_request_id: '55555555-5555-4555-8555-555555555555',
            created_at: '2026-09-16T16:40:00.000Z',
          },
          {
            id: '66666666-6666-4666-8666-666666666666',
            business_id: principal.businessId,
            shop_id: principal.shopIds[0],
            actor_kind: 'HUMAN',
            actor_employee_id: principal.employeeId,
            actor_role: 'OWNER',
            action_type: 'APPROVAL_REJECTED',
            entity_type: 'APPROVAL_REQUEST',
            entity_id: '77777777-7777-4777-8777-777777777777',
            before_value: { status: 'PENDING' },
            after_value: { status: 'REJECTED' },
            reason: 'Denied',
            approval_request_id: '77777777-7777-4777-8777-777777777777',
            created_at: '2026-09-16T16:35:00.000Z',
          },
        ];
      }
      if (table === 'admin_approval_requests') {
        return [
          {
            id: '55555555-5555-4555-8555-555555555555',
            status: 'APPROVED',
          },
          {
            id: '77777777-7777-4777-8777-777777777777',
            status: 'REJECTED',
          },
        ];
      }
      if (table === 'business_employees') {
        return [{ id: principal.employeeId, display_name: 'Owner One' }];
      }
      if (table === 'shops') {
        return [{ id: principal.shopIds[0], name: 'TUX' }];
      }
      throw new Error(`unexpected table ${table}`);
    }),
  } as unknown as AdminSupabaseClient;
}

describe('listAuditReadModels', () => {
  it('filters linked audit events by approval request status', async () => {
    const filters = { approvalStatus: 'APPROVED' } as AuditReadFilters;

    const events = await listAuditReadModels(createClient(), principal, filters);

    expect(events.map((event) => event.id)).toEqual(['44444444-4444-4444-8444-444444444444']);
  });

  it('pushes a shop-scoped reviewer boundary into the audit query before its limit', async () => {
    const manager: AdminSessionPrincipal = {
      ...principal,
      role: 'MANAGER',
      shopIds: ['33333333-3333-4333-8333-333333333333'],
    };
    const select = vi.fn(async (table: string) => {
      if (table === 'admin_audit_events') return [];
      throw new Error(`unexpected table ${table}`);
    });
    const client = { select } as unknown as AdminSupabaseClient;

    await listAuditReadModels(client, manager);

    const auditCall = select.mock.calls.find(([table]) => table === 'admin_audit_events');
    const query = auditCall?.[1] as URLSearchParams | undefined;
    expect(query).toBeInstanceOf(URLSearchParams);
    expect(query?.toString()).toContain('shop_id');
    expect(query?.get('limit')).toBe('100');
  });
});
