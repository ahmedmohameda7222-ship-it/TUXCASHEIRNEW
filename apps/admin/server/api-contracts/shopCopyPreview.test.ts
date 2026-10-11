import { describe, expect, it } from 'vitest';

import {
  shopCopyPreviewSchema,
  shopSettingsCopyApplySchema,
} from '../settings/shopCopyPreviewRoute';

const sourceShopId = '11111111-1111-4111-8111-111111111111';
const targetShopId = '22222222-2222-4222-8222-222222222222';
const input = {
  sourceShopId,
  targetShopId,
  selectedDomains: ['checkout', 'receipts'],
  expectedTargetSettingsVersion: 4,
};

describe('shop selective settings copy preview contract', () => {
  it('accepts only a complete immutable preview snapshot for atomic apply', () => {
    const command = {
      type: 'settings-copy.apply',
      sourceShopId,
      targetShopId,
      selectedDomains: ['checkout'],
      expectedSourceSettingsVersion: 3,
      expectedTargetSettingsVersion: 4,
      expectedChanges: [
        {
          settingKey: 'checkout.taxBps',
          source: 'business',
          sourceValue: 1400,
          sourceExpectedVersion: 2,
          targetSource: 'shop',
          targetValue: 1200,
          targetExpectedVersion: 3,
          wouldChange: true,
        },
      ],
    };
    expect(shopSettingsCopyApplySchema.safeParse(command).success).toBe(true);
    expect(
      shopSettingsCopyApplySchema.safeParse({
        ...command,
        expectedChanges: [
          { ...command.expectedChanges[0], settingKey: 'checkout.unsupported' },
        ],
      }).success,
    ).toBe(false);
    expect(
      shopSettingsCopyApplySchema.safeParse({
        ...command,
        expectedChanges: [command.expectedChanges[0], command.expectedChanges[0]],
      }).success,
    ).toBe(false);
    expect(
      shopSettingsCopyApplySchema.safeParse({
        ...command,
        expectedSourceSettingsVersion: -1,
      }).success,
    ).toBe(false);
  });

  it('accepts explicit source, target, selected domains and target version', () => {
    expect(shopCopyPreviewSchema.safeParse(input).success).toBe(true);
  });

  it('rejects same-shop, missing CAS, unknown domains and unapproved extra fields', () => {
    expect(shopCopyPreviewSchema.safeParse({ ...input, targetShopId: sourceShopId }).success).toBe(
      false,
    );
    expect(
      shopCopyPreviewSchema.safeParse({
        sourceShopId,
        targetShopId,
        selectedDomains: ['checkout'],
      }).success,
    ).toBe(false);
    expect(
      shopCopyPreviewSchema.safeParse({ ...input, selectedDomains: ['inventory'] }).success,
    ).toBe(false);
    expect(
      shopCopyPreviewSchema.safeParse({ ...input, selectedDomains: ['checkout', 'checkout'] })
        .success,
    ).toBe(false);
    expect(shopCopyPreviewSchema.safeParse({ ...input, forceOverwrite: true }).success).toBe(false);
  });
});
