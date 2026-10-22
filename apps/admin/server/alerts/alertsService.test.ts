import type {
  AdminApprovalStatus,
  AdminInventoryIntelligence,
  AdminSessionPrincipal,
} from '@tux/admin-contracts';
import { describe, expect, it, vi } from 'vitest';

import { AdminAuthorizationError } from '../authorization';
import {
  createAlertsService,
  decodeAlertsCursor,
  type AlertsSourceDependencies,
} from './alertsService';

const BUSINESS_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SHOP_A = '11111111-1111-4111-8111-111111111111';
const SHOP_B = '22222222-2222-4222-8222-222222222222';

function principal(
  shopIds: string[],
  permissions: AdminSessionPrincipal['permissions'] = [
    'alerts.view',
    'approvals.review',
    'inventory.view',
  ],
  role: AdminSessionPrincipal['role'] = 'MANAGER',
): AdminSessionPrincipal {
  return {
    employeeId: '33333333-3333-4333-8333-333333333333',
    businessId: BUSINESS_ID,
    role,
    permissions,
    shopIds,
  };
}

function approval(id: string, shopId: string, status: AdminApprovalStatus, createdAt: string) {
  return {
    id,
    requesterName: 'Requester',
    requesterEmployeeId: '44444444-4444-4444-8444-444444444444',
    approverName: null,
    shopId,
    shopName: shopId === SHOP_A ? 'Shop A' : 'Shop B',
    actionLabel: `Action ${id}`,
    valueSummary: 'Value',
    reason: null,
    consequence: 'Review before deciding.',
    status,
    displayStatus: status,
    canDecide: status === 'PENDING',
    executionLabel: status === 'FAILED' ? 'Execution failed' : 'Not started',
    ...(status === 'FAILED'
      ? {
          failureMessage: 'The approved change could not be completed safely.',
          recoveryMessage: 'Review the failure and submit a new request.',
        }
      : {}),
    expiresAt: '2026-12-01T00:00:00.000Z',
    createdAt,
    decidedAt: null,
    executedAt: null,
    failedAt: status === 'FAILED' ? createdAt : null,
  };
}

function inventory(
  suggestions: AdminInventoryIntelligence['reorderSuggestions'],
): AdminInventoryIntelligence {
  return {
    periodLabel: 'Last 30 days',
    reorderSuggestions: suggestions,
    variances: [],
    marginAlerts: [],
  };
}

function dependencies(overrides: Partial<AlertsSourceDependencies> = {}): AlertsSourceDependencies {
  return {
    loadShopName: vi.fn(async (_principal, shopId) => (shopId === SHOP_A ? 'Shop A' : 'Shop B')),
    loadApprovals: vi.fn(async (_principal, shopId) => ({
      approvals: [
        approval(
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          shopId,
          'PENDING',
          '2026-10-20T10:00:00.000Z',
        ),
      ],
      nextCursor: null,
    })),
    loadInventory: vi.fn(async () => inventory([])),
    now: () => new Date('2026-10-22T09:00:00.000Z'),
    ...overrides,
  };
}

describe('alertsService', () => {
  it('scopes every source to the explicitly authorized shop for owners and managers', async () => {
    const ownerDeps = dependencies();
    const managerDeps = dependencies();

    await createAlertsService(ownerDeps).list(
      { shopId: SHOP_A, limit: 20 },
      principal([SHOP_A, SHOP_B], undefined, 'OWNER'),
    );
    await createAlertsService(managerDeps).list({ shopId: SHOP_B, limit: 20 }, principal([SHOP_B]));

    expect(ownerDeps.loadApprovals).toHaveBeenCalledWith(expect.anything(), SHOP_A);
    expect(ownerDeps.loadInventory).toHaveBeenCalledWith(expect.anything(), SHOP_A);
    expect(managerDeps.loadApprovals).toHaveBeenCalledWith(expect.anything(), SHOP_B);
    expect(managerDeps.loadInventory).toHaveBeenCalledWith(expect.anything(), SHOP_B);
  });

  it('rejects an unauthorized shop before loading counts or source data', async () => {
    const deps = dependencies();

    await expect(
      createAlertsService(deps).list({ shopId: SHOP_A, limit: 20 }, principal([SHOP_B])),
    ).rejects.toBeInstanceOf(AdminAuthorizationError);
    expect(deps.loadShopName).not.toHaveBeenCalled();
    expect(deps.loadApprovals).not.toHaveBeenCalled();
    expect(deps.loadInventory).not.toHaveBeenCalled();
  });

  it('omits sources whose detail permission is absent', async () => {
    const deps = dependencies({
      loadInventory: vi.fn(async () =>
        inventory([
          {
            inventoryItemId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            itemName: 'Tomatoes',
            unitLabel: 'kg',
            availableMicros: 0,
            incomingMicros: 0,
            parLevelMicros: 10_000,
            reorderPointMicros: 5_000,
            suggestedOrderMicros: 10_000,
            preferredSupplierId: null,
            preferredPurchaseUnit: null,
            leadTimeDays: 0,
            minimumOrderMicros: null,
            orderMultipleMicros: null,
            version: 1,
          },
        ]),
      ),
    });

    const withoutApprovals = await createAlertsService(deps).list(
      { shopId: SHOP_A, limit: 20 },
      principal([SHOP_A], ['alerts.view', 'inventory.view']),
    );
    expect(withoutApprovals.rows.map((row) => row.source)).toEqual(['INVENTORY']);
    expect(deps.loadApprovals).not.toHaveBeenCalled();

    const withoutInventory = await createAlertsService(dependencies()).list(
      { shopId: SHOP_A, limit: 20 },
      principal([SHOP_A], ['alerts.view', 'approvals.review']),
    );
    expect(withoutInventory.rows.map((row) => row.source)).toEqual(['APPROVAL']);
  });

  it('deduplicates stable normalized IDs and only emits fixed internal hrefs', async () => {
    const duplicate = approval(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      SHOP_A,
      'PENDING',
      '2026-10-20T10:00:00.000Z',
    );
    const deps = dependencies({
      loadApprovals: vi.fn(async () => ({ approvals: [duplicate, duplicate], nextCursor: null })),
    });

    const result = await createAlertsService(deps).list(
      { shopId: SHOP_A, limit: 20 },
      principal([SHOP_A]),
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.id).toMatch(/^alert_[a-f0-9]{32}$/);
    expect(result.rows[0]?.href).toBe('/approvals');
    expect(result.rows.every((row) => row.href.startsWith('/') && !row.href.startsWith('//'))).toBe(
      true,
    );
  });

  it('orders stable ties by id and binds deterministic cursors to scope and filters', async () => {
    const when = '2026-10-20T10:00:00.000Z';
    const deps = dependencies({
      loadApprovals: vi.fn(async () => ({
        approvals: [
          approval('dddddddd-dddd-4ddd-8ddd-dddddddddddd', SHOP_A, 'PENDING', when),
          approval('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', SHOP_A, 'PENDING', when),
        ],
        nextCursor: null,
      })),
    });
    const service = createAlertsService(deps);

    const first = await service.list(
      { shopId: SHOP_A, source: 'APPROVAL', severity: 'WARNING', state: 'ACTIVE', limit: 1 },
      principal([SHOP_A]),
    );
    expect(first.rows).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    expect(decodeAlertsCursor(first.nextCursor!)).toMatchObject({
      businessId: BUSINESS_ID,
      shopId: SHOP_A,
      source: 'APPROVAL',
      severity: 'WARNING',
      state: 'ACTIVE',
      observedAt: when,
    });

    const repeated = await service.list(
      { shopId: SHOP_A, source: 'APPROVAL', severity: 'WARNING', state: 'ACTIVE', limit: 1 },
      principal([SHOP_A]),
    );
    expect(repeated.nextCursor).toBe(first.nextCursor);

    const second = await service.list(
      {
        shopId: SHOP_A,
        source: 'APPROVAL',
        severity: 'WARNING',
        state: 'ACTIVE',
        limit: 1,
        cursor: first.nextCursor!,
      },
      principal([SHOP_A]),
    );
    expect(second.rows).toHaveLength(1);
    expect(second.rows[0]?.id).not.toBe(first.rows[0]?.id);

    await expect(
      service.list(
        { shopId: SHOP_B, source: 'APPROVAL', limit: 1, cursor: first.nextCursor! },
        principal([SHOP_A, SHOP_B]),
      ),
    ).rejects.toThrow(/invalid_alerts_cursor/);
  });

  it('returns an honest empty page and marks independently unavailable sources', async () => {
    const empty = await createAlertsService(
      dependencies({
        loadApprovals: vi.fn(async () => ({ approvals: [], nextCursor: null })),
        loadInventory: vi.fn(async () => inventory([])),
      }),
    ).list({ shopId: SHOP_A, limit: 20 }, principal([SHOP_A]));
    expect(empty.rows).toEqual([]);
    expect(empty.unavailableSources).toEqual([]);

    const partial = await createAlertsService(
      dependencies({
        loadApprovals: vi.fn(async () => {
          throw new Error('approvals unavailable');
        }),
      }),
    ).list({ shopId: SHOP_A, limit: 20 }, principal([SHOP_A]));
    expect(partial.rows).toEqual([]);
    expect(partial.unavailableSources).toEqual(['APPROVAL']);
  });

  it('classifies real actionable approval and reorder records without treating missing data as zero', async () => {
    const deps = dependencies({
      loadApprovals: vi.fn(async () => ({
        approvals: [
          approval(
            'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            SHOP_A,
            'PENDING',
            '2026-10-20T10:00:00.000Z',
          ),
          approval(
            'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            SHOP_A,
            'FAILED',
            '2026-10-21T10:00:00.000Z',
          ),
        ],
        nextCursor: null,
      })),
      loadInventory: vi.fn(async () =>
        inventory([
          {
            inventoryItemId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            itemName: 'Tomatoes',
            unitLabel: 'kg',
            availableMicros: 0,
            incomingMicros: 0,
            parLevelMicros: 10_000,
            reorderPointMicros: 5_000,
            suggestedOrderMicros: 10_000,
            preferredSupplierId: null,
            preferredPurchaseUnit: null,
            leadTimeDays: 0,
            minimumOrderMicros: null,
            orderMultipleMicros: null,
            version: 1,
          },
        ]),
      ),
    });

    const result = await createAlertsService(deps).list(
      { shopId: SHOP_A, limit: 20 },
      principal([SHOP_A]),
    );

    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'APPROVAL', severity: 'WARNING' }),
        expect.objectContaining({ source: 'APPROVAL', severity: 'CRITICAL' }),
        expect.objectContaining({ source: 'INVENTORY', severity: 'CRITICAL' }),
      ]),
    );
    expect(result.rows).toHaveLength(3);
  });
});
