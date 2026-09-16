import type { AdminSettingsWorkspace } from '@tux/admin-contracts';
import { describe, expect, it } from 'vitest';

import { buildOrderTypeUpdateCommand, buildPaymentMethodUpdateCommand } from './useSettings';

const shopId = '11111111-1111-4111-8111-111111111111';

function workspace(
  settingsVersion: number,
  orderEditVersion: number,
  paymentEditVersion: number,
): AdminSettingsWorkspace {
  return {
    shop: {
      id: shopId,
      name: 'TUX Maadi',
      lifecycleState: 'ACTIVE',
      active: true,
      address: null,
      contactPhone: null,
      latitude: null,
      longitude: null,
      timezone: 'Africa/Cairo',
      temporaryClosed: false,
      onlineOrdersPaused: false,
    },
    settingsVersion,
    businessDefaults: [],
    shopOverrides: [],
    orderTypes: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Take Away',
        behavior: 'TAKE_AWAY',
        active: true,
        sortOrder: 10,
        editVersion: orderEditVersion,
      },
    ],
    paymentMethods: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        displayName: 'Cash',
        logicType: 'CASH',
        requiresReconciliation: true,
        active: true,
        sortOrder: 10,
        channel: 'BOTH',
        requiresReference: false,
        manualConfirmationRequired: false,
        refundAllowed: true,
        integrationReference: null,
        editVersion: paymentEditVersion,
      },
    ],
    deliveryZones: [],
    reasonCodes: [],
    weeklyHours: [],
    specialHours: [],
  };
}

describe('canonical settings form-captured CAS', () => {
  it('preserves order-type CAS tokens captured when editing began after the workspace refreshes', () => {
    const refreshed = workspace(8, 4, 6);
    const command = buildOrderTypeUpdateCommand(shopId, refreshed, {
      orderTypeId: refreshed.orderTypes[0]!.id,
      name: 'Local edit',
      behavior: 'TAKE_AWAY',
      active: true,
      sortOrder: 20,
      expectedSettingsVersion: 7,
      expectedEditVersion: 3,
    } as never);

    expect(command.expectedSettingsVersion).toBe(7);
    expect(command.expectedEditVersion).toBe(3);
  });

  it('preserves payment-method CAS tokens captured when editing began after the workspace refreshes', () => {
    const refreshed = workspace(8, 4, 6);
    const command = buildPaymentMethodUpdateCommand(shopId, refreshed, {
      paymentMethodId: refreshed.paymentMethods[0]!.id,
      displayName: 'Local Cash',
      active: true,
      sortOrder: 20,
      channel: 'BOTH',
      requiresReference: false,
      manualConfirmationRequired: false,
      refundAllowed: true,
      expectedSettingsVersion: 7,
      expectedEditVersion: 5,
    } as never);

    expect(command.expectedSettingsVersion).toBe(7);
    expect(command.expectedEditVersion).toBe(5);
  });
});
