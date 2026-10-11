import { describe, expect, it } from 'vitest';

import {
  approvalRuleWriteSchema,
  requireApprovalRuleManagement,
  thresholdContextFromDraft,
} from '../../api/admin/approval-rules';

const shopId = 'c5579c9a-b2f2-5aa2-b1ed-a3a9b2492b46';
const ruleInput = {
  type: 'rule.upsert',
  ruleId: null,
  shopId,
  actionType: 'inventory.adjust',
  requesterPermission: 'inventory.adjust',
  approverPermission: 'approvals.review',
  requiresSecondPerson: true,
  requiresRequesterRepin: false,
  expiresAfterSeconds: 86_400,
  threshold: { kind: 'minimumQuantityImpact', value: 1000 },
  active: true,
  expectedVersion: null,
} as const;

const owner = {
  employeeId: 'owner',
  businessId: 'business',
  role: 'OWNER' as const,
  permissions: ['settings.manage' as const],
  shopIds: [shopId],
};

describe('approval rule management boundary', () => {
  it('accepts an explicitly typed threshold with CAS for creation and update', () => {
    expect(approvalRuleWriteSchema.safeParse(ruleInput).success).toBe(true);
    expect(
      approvalRuleWriteSchema.safeParse({
        ...ruleInput,
        ruleId: '3a7bd7ed-f722-4f91-bc32-4549a4897937',
        expectedVersion: 4,
        threshold: { kind: 'minimumMinor', value: 25_000 },
      }).success,
    ).toBe(true);
  });

  it('rejects arbitrary JSON, unsupported threshold modes and stale-shape commands', () => {
    for (const command of [
      { ...ruleInput, threshold: { arbitraryBypass: true } },
      { ...ruleInput, threshold: { kind: 'minimumMinor', value: -1 } },
      { ...ruleInput, threshold: { kind: 'minimumMinor', value: 10, arbitrary: 1 } },
      { ...ruleInput, threshold: { kind: 'minimumMinor', value: 1.5 } },
      { ...ruleInput, threshold: { kind: 'none', value: 0 } },
      { ...ruleInput, approverPermission: 'settings.manage' },
      { ...ruleInput, expectedVersion: 5 },
      { ...ruleInput, extraPolicy: 'unsafe' },
    ]) {
      expect(approvalRuleWriteSchema.safeParse(command).success).toBe(false);
    }
  });

  it('serializes only threshold concepts evaluated by the approval engine', () => {
    expect(thresholdContextFromDraft({ kind: 'none' })).toEqual({});
    expect(thresholdContextFromDraft({ kind: 'minimumMinor', value: 3400 })).toEqual({
      minimumMinor: 3400,
    });
    expect(thresholdContextFromDraft({ kind: 'minimumQuantityImpact', value: 2000 })).toEqual({
      minimumQuantityImpact: 2000,
    });
  });

  it('separates rule configuration authority from approval-decision access', () => {
    expect(() => requireApprovalRuleManagement(owner, shopId)).not.toThrow();
    expect(() =>
      requireApprovalRuleManagement(
        { ...owner, role: 'MANAGER', permissions: ['approvals.review'] },
        shopId,
      ),
    ).toThrow('permission_forbidden');
    expect(() => requireApprovalRuleManagement({ ...owner, role: 'MANAGER' }, null)).toThrow(
      'permission_forbidden',
    );
    expect(() =>
      requireApprovalRuleManagement(
        { ...owner, role: 'MANAGER' },
        '00000000-0000-4000-8000-000000000000',
      ),
    ).toThrow('shop_forbidden');
  });
});
