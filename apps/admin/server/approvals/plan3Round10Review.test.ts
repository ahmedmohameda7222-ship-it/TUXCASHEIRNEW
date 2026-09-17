import type { AdminSessionPrincipal } from '@tux/admin-contracts';
import { describe, expect, it, vi } from 'vitest';

import { appendAuditEvent } from '../audit/auditService';
import * as auditReadModule from '../audit/auditReadService';
import type { AdminSupabaseClient } from '../supabaseAdmin';
import {
  createApprovalExecutionRegistry,
  createApprovalExecutionService,
  type ApprovalExecutionClaim,
} from './approvalExecutionService';
import * as approvalReadModule from './approvalReadService';

const principal: AdminSessionPrincipal = {
  employeeId: 'approver-1',
  businessId: 'business-1',
  role: 'OWNER',
  permissions: ['approvals.review', 'audit.view'],
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

function auditRow(index: number) {
  const createdAt = new Date(Date.UTC(2026, 8, 18, 0, 0, 0) - index * 1_000).toISOString();
  return {
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    business_id: principal.businessId,
    shop_id: principal.shopIds[0],
    actor_kind: 'HUMAN' as const,
    actor_employee_id: principal.employeeId,
    actor_role: 'OWNER',
    requester_employee_id: null,
    approver_employee_id: null,
    action_type: 'INVENTORY_ADJUSTMENT',
    entity_type: 'INVENTORY_ITEM',
    entity_id: `item-${index}`,
    before_value: { quantity: index + 1 },
    after_value: { quantity: index },
    reason: 'Cycle count mismatch',
    approval_request_id: null,
    created_at: createdAt,
  } as const;
}

function pageReader() {
  return (approvalReadModule as Record<string, unknown>)['listApprovalReadPage'];
}

function auditPageReader() {
  return (auditReadModule as Record<string, unknown>)['listAuditReadPage'];
}

const executionClaim: ApprovalExecutionClaim = {
  approvalRequestId: 'request-1',
  businessId: 'business-1',
  shopId: principal.shopIds[0] ?? null,
  requesterEmployeeId: 'requester-1',
  approverEmployeeId: principal.employeeId,
  actionType: 'TEST_COMMAND',
  commandId: 'command-1',
  commandPayload: { entityId: 'entity-1' },
  claimToken: 'claim-token-1',
  attemptCount: 1,
  leaseExpiresAt: '2026-09-18T00:05:00.000Z',
};

describe('Plan 3 round 10/11 review regressions', () => {
  it('returns a continuation cursor and applies it before the next bounded approval page', async () => {
    const listPage = pageReader();
    expect(typeof listPage).toBe('function');
    if (typeof listPage !== 'function') return;

    const rows = Array.from({ length: 101 }, (_, index) => requestRow(index));
    const select = vi.fn(async (table: string, query?: URLSearchParams) => {
      void query;
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
    expect(firstApprovalCall?.[1]?.get('limit')).toBe('101');
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
    const nextQuery = secondApprovalCall?.[1];
    expect(nextQuery?.get('or')).toContain(`created_at.lt.${first.nextCursor?.createdAt}`);
    expect(nextQuery?.get('or')).toContain(`id.lt.${first.nextCursor?.id}`);
  });

  it('preserves ADMIN assigned-shop plus business-wide scope when applying a cursor', async () => {
    const listPage = pageReader();
    expect(typeof listPage).toBe('function');
    if (typeof listPage !== 'function') return;

    const admin: AdminSessionPrincipal = { ...principal, role: 'ADMIN' };
    const row = requestRow(0);
    const select = vi.fn(async (table: string, query?: URLSearchParams) => {
      void query;
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
    const query = approvalCall?.[1];
    const combined = query?.get('and') ?? '';
    expect(combined).toContain('shop_id.is.null');
    expect(combined).toContain(`shop_id.in.(${admin.shopIds[0]})`);
    expect(combined).toContain('created_at.lt.2026-09-18T00:00:00.000Z');
    expect(combined).toContain('id.lt.approval-099');
  });

  it('rejects structured API credential keys before immutable audit persistence', async () => {
    const append = vi.fn(async () => 'audit-1');
    for (const key of ['apiKey', 'clientSecret', 'accessKey', 'secretKey', 'privateKey']) {
      await expect(
        appendAuditEvent(
          {
            businessId: principal.businessId,
            shopId: principal.shopIds[0] ?? null,
            actorEmployeeId: principal.employeeId,
            actionType: 'SECURITY_SETTING_CHANGED',
            entityType: 'SETTING',
            entityId: 'setting-1',
            beforeValue: null,
            afterValue: { [key]: 'must-never-persist' },
            reason: 'credential rotation',
            approvalRequestId: null,
            sessionId: 'session-1',
            contextMetadata: {},
          },
          { append },
        ),
      ).rejects.toThrowError('admin_audit_credential_material_forbidden');
    }
    expect(append).not.toHaveBeenCalled();
  });

  it('redacts structured API credential keys from durable execution result metadata', async () => {
    const completeClaim = vi.fn(async () => ({ ok: true as const, status: 'EXECUTED' as const }));
    const service = createApprovalExecutionService({
      claimApprovedCommand: vi.fn(async () => [executionClaim]),
      completeClaim,
      registry: createApprovalExecutionRegistry([
        {
          actionType: executionClaim.actionType,
          execute: vi.fn(async () => ({
            idempotentReplay: false,
            result: {
              entityId: 'entity-1',
              apiKey: 'api-secret',
              clientSecret: 'client-secret',
              nested: { accessKey: 'access-secret', safeLabel: 'kept' },
            },
          })),
        },
      ]),
      workerId: 'round-11-test',
    });

    await service.runOnce();

    expect(completeClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'EXECUTED',
        resultMetadata: {
          idempotentReplay: false,
          result: { entityId: 'entity-1', nested: { safeLabel: 'kept' } },
        },
      }),
    );
  });

  it('returns an audit continuation cursor and applies it before the next bounded direct page', async () => {
    const listPage = auditPageReader();
    expect(typeof listPage).toBe('function');
    if (typeof listPage !== 'function') return;

    const rows = Array.from({ length: 101 }, (_, index) => auditRow(index));
    let auditReads = 0;
    const select = vi.fn(async (table: string, query?: URLSearchParams) => {
      if (table === 'admin_audit_events') {
        auditReads += 1;
        return auditReads === 1 ? rows : [];
      }
      if (table === 'business_employees') {
        return [{ id: principal.employeeId, display_name: 'Owner One' }];
      }
      if (table === 'shops') return [{ id: principal.shopIds[0], name: 'TUX' }];
      throw new Error(`unexpected table ${table}; query=${query?.toString() ?? ''}`);
    });
    const client = { select } as unknown as AdminSupabaseClient;

    const first = (await listPage(client, principal)) as {
      events: readonly { id: string }[];
      nextCursor: { createdAt: string; id: string } | null;
    };
    expect(first.events).toHaveLength(100);
    expect(first.nextCursor).toEqual({
      createdAt: rows[99]?.created_at,
      id: rows[99]?.id,
    });

    await listPage(client, principal, { cursor: first.nextCursor });
    const auditCalls = select.mock.calls.filter(([table]) => table === 'admin_audit_events');
    const nextQuery = auditCalls[1]?.[1];
    expect(nextQuery?.get('limit')).toBe('101');
    expect(nextQuery?.get('or')).toContain(`created_at.lt.${first.nextCursor?.createdAt}`);
    expect(nextQuery?.get('or')).toContain(`id.lt.${first.nextCursor?.id}`);
  });

  it('passes the audit cursor through the scoped approval-status RPC', async () => {
    const listPage = auditPageReader();
    expect(typeof listPage).toBe('function');
    if (typeof listPage !== 'function') return;

    const admin: AdminSessionPrincipal = { ...principal, role: 'ADMIN' };
    const cursor = {
      createdAt: '2026-09-17T20:00:00.000Z',
      id: '99999999-9999-4999-8999-999999999999',
    };
    const rpc = vi.fn(async (name: string, payload: Readonly<Record<string, unknown>>) => {
      expect(name).toBe('list_admin_audit_events_v3');
      expect(payload).toEqual(
        expect.objectContaining({
          p_business_id: admin.businessId,
          p_shop_ids: admin.shopIds,
          p_include_business_wide: true,
          p_approval_status: 'APPROVED',
          p_before_created_at: cursor.createdAt,
          p_before_id: cursor.id,
          p_limit: 101,
        }),
      );
      return [];
    });

    await listPage({ rpc, select: vi.fn() } as unknown as AdminSupabaseClient, admin, {
      approvalStatus: 'APPROVED',
      cursor,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
