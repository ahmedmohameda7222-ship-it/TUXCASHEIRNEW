import { describe, expect, it } from 'vitest';

import { configurableApprovalAction } from './approvalRuleActions';
import { createApprovalExecutionRegistry } from './approvalExecutionService';
import { createInventoryAdjustmentApprovalExecutionEntries } from '../inventory/inventoryApproval';

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
});
