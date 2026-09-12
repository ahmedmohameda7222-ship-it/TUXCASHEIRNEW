import { describe, expect, it } from 'vitest';

import { settingsCommandSchema, settingsViewSchema } from './settings';

const shopId = 'c5579c9a-b2f2-5aa2-b1ed-a3a9b2492b46';
const orderTypeId = 'a373f2ac-6a95-59a2-a630-1b1b9d5a3224';
const paymentMethodId = '8b4fe5d4-7c88-5d42-859f-1e8ec4a89457';

describe('Admin settings API contract', () => {
  it('accepts only the reviewed settings workspace view', () => {
    expect(settingsViewSchema.safeParse('workspace').success).toBe(true);
    expect(settingsViewSchema.safeParse('internal').success).toBe(false);
  });

  it('accepts version-fenced publish and archive commands', () => {
    expect(
      settingsCommandSchema.safeParse({
        type: 'settings.publish',
        shopId,
        expectedSettingsVersion: 4,
      }).success,
    ).toBe(true);
    expect(
      settingsCommandSchema.safeParse({
        type: 'shop.delete-or-archive',
        shopId,
      }).success,
    ).toBe(true);
  });

  it('accepts strict business-default and shop-override writes', () => {
    expect(
      settingsCommandSchema.safeParse({
        type: 'setting.default.upsert',
        shopId,
        settingKey: 'checkout.minimumOrderMinor',
        value: 1500,
        expectedVersion: null,
      }).success,
    ).toBe(true);
    expect(
      settingsCommandSchema.safeParse({
        type: 'setting.override.upsert',
        shopId,
        settingKey: 'receipt.orderPrefix',
        value: 'MD-',
        expectedVersion: 2,
      }).success,
    ).toBe(true);
  });

  it('accepts strict version-fenced canonical order type edits', () => {
    expect(
      settingsCommandSchema.safeParse({
        type: 'order-type.update',
        shopId,
        orderTypeId,
        name: 'Pick up',
        behavior: 'TAKE_AWAY',
        active: true,
        sortOrder: 1,
        expectedSettingsVersion: 4,
        expectedEditVersion: 2,
      }).success,
    ).toBe(true);
  });

  it('accepts only approved payment configuration fields', () => {
    const command = {
      type: 'payment-method.update',
      shopId,
      paymentMethodId,
      displayName: 'InstaPay',
      active: true,
      sortOrder: 2,
      channel: 'ONLINE',
      requiresReference: true,
      manualConfirmationRequired: true,
      refundAllowed: false,
      expectedSettingsVersion: 4,
      expectedEditVersion: 7,
    };

    expect(settingsCommandSchema.safeParse(command).success).toBe(true);
    expect(settingsCommandSchema.safeParse({ ...command, logicType: 'CASH' }).success).toBe(false);
    expect(
      settingsCommandSchema.safeParse({ ...command, requiresReconciliation: true }).success,
    ).toBe(false);
  });

  it('rejects unreviewed commands, unsafe setting keys, and malformed versions', () => {
    expect(settingsCommandSchema.safeParse({ type: 'settings.anything', shopId }).success).toBe(
      false,
    );
    expect(
      settingsCommandSchema.safeParse({
        type: 'setting.override.upsert',
        shopId,
        settingKey: '__proto__',
        value: true,
        expectedVersion: null,
      }).success,
    ).toBe(false);
    expect(
      settingsCommandSchema.safeParse({
        type: 'settings.publish',
        shopId,
        expectedSettingsVersion: -1,
      }).success,
    ).toBe(false);
    expect(
      settingsCommandSchema.safeParse({
        type: 'order-type.update',
        shopId,
        orderTypeId,
        name: 'Pick up',
        behavior: 'TAKE_AWAY',
        active: true,
        sortOrder: 1,
        expectedSettingsVersion: 4,
        expectedEditVersion: 0,
      }).success,
    ).toBe(false);
  });
});
