import { describe, expect, it } from 'vitest';

import { APPROVAL_RULE_ACTIONS } from './approvalRuleActions';

describe('Shop lifecycle approval: supported executable action', () => {
  it('is not configurable unless wired to the protected shop lifecycle runner', () => {
    const action = APPROVAL_RULE_ACTIONS.find(
      (entry) => entry.actionType === 'SHOP_LIFECYCLE_CHANGE',
    );
    expect(action).toEqual({
      actionType: 'SHOP_LIFECYCLE_CHANGE',
      label: 'Shop suspension / reactivation',
      requesterPermission: 'shops.manage',
      thresholdKind: null,
    });
  });
});
