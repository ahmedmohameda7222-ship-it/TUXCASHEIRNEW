import type { AdminSettingsWorkspace } from '@tux/admin-contracts';
import { describe, expect, it } from 'vitest';

import {
  SettingsUiError,
  buildOrderTypeUpdateCommand,
  buildPaymentMethodUpdateCommand,
} from './useSettings';

const shopId = '11111111-1111-4111-8111-111111111111';

const workspace: AdminSettingsWorkspace = {
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
  settingsVersion: 7,
  businessDefaults: [],
  shopOverrides: [],
  orderTypes: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Take Away',
      behavior: 'TAKE_AWAY',
      active: true,
      sortOrder: 10,
      editVersion: 3,
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
      editVersion: 5,
    },
  ],
  deliveryZones: [],
  reasonCodes: [],
  weeklyHours: [],
  specialHours: [],
};

describe('Settings client CAS command builders', () => {
  it('derives order type CAS versions from the latest loaded workspace', () => {
    expect(
      buildOrderTypeUpdateCommand(shopId, workspace, {
        orderTypeId: workspace.orderTypes[0]!.id,
        name: 'Pick up',
        behavior: 'TAKE_AWAY',
        active: false,
        sortOrder: 20,
      }),
    ).toEqual({
      type: 'order-type.update',
      shopId,
      orderTypeId: workspace.orderTypes[0]!.id,
      name: 'Pick up',
      behavior: 'TAKE_AWAY',
      active: false,
      sortOrder: 20,
      expectedSettingsVersion: 7,
      expectedEditVersion: 3,
    });
  });

  it('derives payment CAS versions while dropping protected operational semantics', () => {
    const command = buildPaymentMethodUpdateCommand(shopId, workspace, {
      paymentMethodId: workspace.paymentMethods[0]!.id,
      displayName: 'Front Cash',
      active: true,
      sortOrder: 15,
      channel: 'POS',
      requiresReference: true,
      manualConfirmationRequired: true,
      refundAllowed: false,
      logicType: 'CARD',
      requiresReconciliation: false,
    } as never);

    expect(command).toEqual({
      type: 'payment-method.update',
      shopId,
      paymentMethodId: workspace.paymentMethods[0]!.id,
      displayName: 'Front Cash',
      active: true,
      sortOrder: 15,
      channel: 'POS',
      requiresReference: true,
      manualConfirmationRequired: true,
      refundAllowed: false,
      expectedSettingsVersion: 7,
      expectedEditVersion: 5,
    });
    expect(command).not.toHaveProperty('logicType');
    expect(command).not.toHaveProperty('requiresReconciliation');
  });

  it('fails closed when the requested canonical row is not in the loaded workspace', () => {
    expect(() =>
      buildOrderTypeUpdateCommand(shopId, workspace, {
        orderTypeId: '44444444-4444-4444-8444-444444444444',
        name: 'Missing',
        behavior: 'OTHER',
        active: true,
        sortOrder: 0,
      }),
    ).toThrowError(new SettingsUiError('order_type_not_loaded'));

    expect(() =>
      buildPaymentMethodUpdateCommand(shopId, workspace, {
        paymentMethodId: '55555555-5555-4555-8555-555555555555',
        displayName: 'Missing',
        active: true,
        sortOrder: 0,
        channel: 'BOTH',
        requiresReference: false,
        manualConfirmationRequired: false,
        refundAllowed: false,
      }),
    ).toThrowError(new SettingsUiError('payment_method_not_loaded'));
  });
});
