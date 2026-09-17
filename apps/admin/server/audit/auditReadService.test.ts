import type { AdminSessionPrincipal } from '@tux/admin-contracts';
import { describe, expect, it, vi } from 'vitest';

import type { AdminSupabaseClient } from '../supabaseAdmin';
import * as auditReadService from './auditReadService';

const { listAuditReadModels } = auditReadService;

const principal: AdminSessionPrincipal = {
  employeeId: '11111111-1111-4111-8111-111111111111',
  businessId: '22222222-2222-4222-8222-222222222222',
  role: 'OWNER',
  permissions: ['audit.view'],
  shopIds: ['33333333-3333-4333-8333-333333333333'],
};

const approvedEvent = {
  id: '44444444-4444-4444-8444-444444444444',
  business_id: principal.businessId,
  shop_id: principal.shopIds[0],
  actor_kind: 'HUMAN' as const,
  actor_employee_id: principal.employeeId,
  actor_role: 'OWNER',
  requester_employee_id: null,
  approver_employee_id: null,
  action_type: 'APPROVAL_APPROVED',
  entity_type: 'APPROVAL_REQUEST',
  entity_id: '55555555-5555-4555-8555-555555555555',
  before_value: { status: 'PENDING' },
  after_value: { status: 'APPROVED' },
  reason: 'Reviewed',
  approval_request_id: '55555555-5555-4555-8555-555555555555',
  approval_status: 'APPROVED' as const,
  created_at: '2026-09-16T16:40:00.000Z',
};

function createClient(): AdminSupabaseClient {
  return {
    select: vi.fn(async (table: string, query?: URLSearchParams) => {
      void query;
      if (table === 'admin_audit_events') {
        return [
          approvedEvent,
          {
            ...approvedEvent,
            id: '66666666-6666-4666-8666-666666666666',
            action_type: 'APPROVAL_REJECTED',
            entity_id: '77777777-7777-4777-8777-777777777777',
            after_value: { status: 'REJECTED' },
            reason: 'Denied',
            approval_request_id: '77777777-7777-4777-8777-777777777777',
            approval_status: 'REJECTED' as const,
            created_at: '2026-09-16T16:35:00.000Z',
          },
        ];
      }
      if (table === 'admin_approval_requests') {
        return [
          { id: '55555555-5555-4555-8555-555555555555', status: 'APPROVED' },
          { id: '77777777-7777-4777-8777-777777777777', status: 'REJECTED' },
        ];
      }
      if (table === 'business_employees') {
        return [{ id: principal.employeeId, display_name: 'Owner One' }];
      }
      if (table === 'shops') return [{ id: principal.shopIds[0], name: 'TUX' }];
      throw new Error(`unexpected table ${table}`);
    }),
  } as unknown as AdminSupabaseClient;
}

describe('listAuditReadModels', () => {
  it('filters linked audit events by approval request status', async () => {
    const filters = { approvalStatus: 'APPROVED' } as const;
    const events = await listAuditReadModels(createClient(), principal, filters);
    expect(events.map((event) => event.id)).toEqual(['44444444-4444-4444-8444-444444444444']);
  });

  it('returns the actor label contract consumed by the audit UI', async () => {
    const [event] = await listAuditReadModels(createClient(), principal, {
      approvalStatus: 'APPROVED',
    });
    const serialized = event as unknown as Record<string, unknown>;
    expect(serialized['actorLabel']).toBe('Owner One');
    expect(serialized['actorName']).toBeUndefined();
  });

  it('loads actor options from scoped audit history so former shop actors remain filterable', async () => {
    const loadActorOptions = auditReadService.listAuditActorOptions;
    const manager: AdminSessionPrincipal = {
      ...principal,
      role: 'MANAGER',
      shopIds: ['33333333-3333-4333-8333-333333333333'],
    };
    const rpc = vi.fn(async (name: string, payload: Readonly<Record<string, unknown>>) => {
      if (name !== 'list_admin_audit_actor_options_v2') throw new Error(`unexpected rpc ${name}`);
      expect(payload).toEqual({
        p_business_id: manager.businessId,
        p_shop_ids: manager.shopIds,
        p_include_business_wide: false,
      });
      return [
        {
          employee_id: '99999999-9999-4999-8999-999999999999',
          display_name: 'Former Shop Actor',
        },
      ];
    });
    const select = vi.fn(async (table: string) => {
      throw new Error(`actor options must not depend on current assignments: ${table}`);
    });

    const options = await loadActorOptions(
      { rpc, select } as unknown as AdminSupabaseClient,
      manager,
    );

    expect(options).toEqual([
      { employeeId: '99999999-9999-4999-8999-999999999999', label: 'Former Shop Actor' },
    ]);
  });

  it('scopes ADMIN actor options to assigned shops plus business-wide audit history', async () => {
    const admin: AdminSessionPrincipal = {
      ...principal,
      role: 'ADMIN',
      shopIds: ['33333333-3333-4333-8333-333333333333'],
    };
    const rpc = vi.fn(async (name: string, payload: Readonly<Record<string, unknown>>) => {
      expect(name).toBe('list_admin_audit_actor_options_v2');
      expect(payload).toEqual({
        p_business_id: admin.businessId,
        p_shop_ids: admin.shopIds,
        p_include_business_wide: true,
      });
      return [];
    });

    await auditReadService.listAuditActorOptions(
      { rpc, select: vi.fn() } as unknown as AdminSupabaseClient,
      admin,
    );
  });

  it('pushes approval status into the bounded database audit query instead of materializing capped IDs', async () => {
    const rpc = vi.fn(async (name: string, payload: Readonly<Record<string, unknown>>) => {
      if (name !== 'list_admin_audit_events_v2') throw new Error(`unexpected rpc ${name}`);
      expect(payload).toEqual(
        expect.objectContaining({
          p_business_id: principal.businessId,
          p_approval_status: 'APPROVED',
          p_include_business_wide: true,
          p_limit: 100,
        }),
      );
      return [approvedEvent];
    });
    const select = vi.fn(async (table: string) => {
      if (table === 'business_employees') {
        return [{ id: principal.employeeId, display_name: 'Owner One' }];
      }
      if (table === 'shops') return [{ id: principal.shopIds[0], name: 'TUX' }];
      throw new Error(`unexpected table ${table}`);
    });
    const client = { rpc, select } as unknown as AdminSupabaseClient;

    const events = await listAuditReadModels(client, principal, { approvalStatus: 'APPROVED' });

    expect(events).toHaveLength(1);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(select.mock.calls.some(([table]) => table === 'admin_approval_requests')).toBe(false);
  });

  it('pushes a shop-scoped reviewer boundary into the audit query before its limit', async () => {
    const manager: AdminSessionPrincipal = {
      ...principal,
      role: 'MANAGER',
      shopIds: ['33333333-3333-4333-8333-333333333333'],
    };
    const select = vi.fn(async (table: string, query?: URLSearchParams) => {
      void query;
      if (table === 'admin_audit_events') return [];
      throw new Error(`unexpected table ${table}`);
    });
    const client = { select } as unknown as AdminSupabaseClient;

    await listAuditReadModels(client, manager);

    const auditCall = select.mock.calls.find(([table]) => table === 'admin_audit_events');
    const query = auditCall?.[1];
    expect(query).toBeInstanceOf(URLSearchParams);
    expect(query?.get('shop_id')).toBe(`in.(${manager.shopIds[0]})`);
    expect(query?.get('limit')).toBe('100');
  });

  it('pushes ADMIN assigned shops plus business-wide events before the direct-query limit', async () => {
    const admin: AdminSessionPrincipal = {
      ...principal,
      role: 'ADMIN',
      shopIds: ['33333333-3333-4333-8333-333333333333'],
    };
    const select = vi.fn(async (table: string, query?: URLSearchParams) => {
      void query;
      if (table === 'admin_audit_events') return [];
      throw new Error(`unexpected table ${table}`);
    });

    await listAuditReadModels({ select } as unknown as AdminSupabaseClient, admin);

    const auditCall = select.mock.calls.find(([table]) => table === 'admin_audit_events');
    const query = auditCall?.[1];
    expect(query?.get('shop_id')).toBeNull();
    expect(query?.get('or')).toBe(`(shop_id.is.null,shop_id.in.(${admin.shopIds[0]}))`);
    expect(query?.get('limit')).toBe('100');
  });

  it('passes ADMIN assigned shops plus business-wide authority into the audit status RPC', async () => {
    const admin: AdminSessionPrincipal = {
      ...principal,
      role: 'ADMIN',
      shopIds: ['33333333-3333-4333-8333-333333333333'],
    };
    const rpc = vi.fn(async (name: string, payload: Readonly<Record<string, unknown>>) => {
      expect(name).toBe('list_admin_audit_events_v2');
      expect(payload).toEqual(
        expect.objectContaining({
          p_business_id: admin.businessId,
          p_shop_ids: admin.shopIds,
          p_include_business_wide: true,
          p_approval_status: 'APPROVED',
          p_limit: 100,
        }),
      );
      return [];
    });

    await listAuditReadModels(
      { rpc, select: vi.fn() } as unknown as AdminSupabaseClient,
      admin,
      { approvalStatus: 'APPROVED' },
    );
  });
});