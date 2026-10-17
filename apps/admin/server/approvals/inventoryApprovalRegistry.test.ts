import { describe, expect, it } from 'vitest';
import type { AdminApprovalRule } from '@tux/admin-contracts';

import { configurableApprovalAction } from './approvalRuleActions';
import { createApprovalExecutionRegistry } from './approvalExecutionService';
import {
  createInventoryAdjustmentApprovalExecutionEntries,
  evaluateInventoryAdjustmentRouting,
} from '../inventory/inventoryApproval';

describe('high-risk inventory adjustment approval coverage', () => {
  it('exposes a quantity-threshold action only when a durable execution handler exists', () => {
    expect(configurableApprovalAction('INVENTORY_ADJUST')).toEqual({
      actionType: 'INVENTORY_ADJUST',
      label: 'Inventory adjustment',
      requesterPermission: 'inventory.adjust',
      thresholdKind: 'minimumQuantityImpact',
    });

    const registry = createApprovalExecutionRegistry(
      createInventoryAdjustmentApprovalExecutionEntries({
        executeAdjustment: async () => ({ ok: true, idempotentReplay: false }),
      }),
    );
    expect(registry.has('INVENTORY_ADJUST')).toBe(true);
  });

  it('matches positive and negative quantities exactly in micros at the threshold', () => {
    const rule: AdminApprovalRule = {
      id: 'global',
      businessId: 'business-a',
      shopId: null,
      actionType: 'INVENTORY_ADJUST',
      requesterPermission: 'inventory.adjust',
      approverPermission: 'approvals.review',
      requiresSecondPerson: true,
      requiresRequesterRepin: false,
      thresholdContext: { minimumQuantityImpact: 5 },
      active: true,
    };
    const actor = { businessId: 'business-a' };
    const decide = (quantityDeltaMicros: number) =>
      evaluateInventoryAdjustmentRouting({ shopId: 'shop-a', quantityDeltaMicros }, actor, [rule]);
    expect(decide(4_999_999)).toEqual({ kind: 'DIRECT' });
    expect(decide(-4_999_999)).toEqual({ kind: 'DIRECT' });
    expect(decide(5_000_000)).toEqual({ kind: 'APPROVAL_REQUIRED', ruleId: 'global' });
    expect(decide(-5_000_000)).toEqual({ kind: 'APPROVAL_REQUIRED', ruleId: 'global' });
    expect(decide(5_000_001)).toEqual({ kind: 'APPROVAL_REQUIRED', ruleId: 'global' });
  });

  it('enforces the governing shop rule and fails closed on corrupt numeric thresholds', () => {
    const global: AdminApprovalRule = {
      id: 'global',
      businessId: 'business-a',
      shopId: null,
      actionType: 'INVENTORY_ADJUST',
      requesterPermission: 'inventory.adjust',
      approverPermission: 'approvals.review',
      requiresSecondPerson: true,
      requiresRequesterRepin: false,
      thresholdContext: { minimumQuantityImpact: 5 },
      active: true,
    };
    const local: AdminApprovalRule = {
      ...global,
      id: 'local',
      shopId: 'shop-a',
      thresholdContext: { minimumQuantityImpact: 10 },
    };
    const shopA = { shopId: 'shop-a', quantityDeltaMicros: 7_000_000 };
    const shopB = { shopId: 'shop-b', quantityDeltaMicros: 7_000_000 };
    const actor = { businessId: 'business-a' };
    expect(evaluateInventoryAdjustmentRouting(shopA, actor, [global, local])).toEqual({
      kind: 'DIRECT',
    });
    expect(evaluateInventoryAdjustmentRouting(shopB, actor, [global, local])).toEqual({
      kind: 'APPROVAL_REQUIRED',
      ruleId: 'global',
    });
    expect(evaluateInventoryAdjustmentRouting(shopA, actor, [{ ...local, active: false }])).toEqual(
      { kind: 'DIRECT' },
    );
    expect(
      evaluateInventoryAdjustmentRouting(shopA, actor, [
        { ...local, thresholdContext: { minimumQuantityImpact: 0 } },
      ]),
    ).toEqual({ kind: 'INVALID', code: 'approval_threshold_context_invalid' });
  });
});
