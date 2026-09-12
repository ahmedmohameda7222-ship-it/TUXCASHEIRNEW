import type { AdminSettingsWorkspace } from '@tux/admin-contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { SettingsWorkspaceView, type SettingsSection } from './SettingsPage';
import { ReceiptsPage } from './ReceiptsPage';
import { ReasonCodesPage } from './ReasonCodesPage';

const workspace: AdminSettingsWorkspace = {
  shop: {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'TUX Maadi',
    lifecycleState: 'ACTIVE',
    active: true,
    address: 'Road 9, Maadi',
    contactPhone: '+201000000000',
    latitude: 29.9602,
    longitude: 31.2569,
    timezone: 'Africa/Cairo',
    temporaryClosed: false,
    onlineOrdersPaused: false,
  },
  settingsVersion: 7,
  businessDefaults: [
    { key: 'checkout.minimumOrderMinor', value: 3000, version: 1 },
    { key: 'checkout.serviceChargeBps', value: 500, version: 1 },
    { key: 'checkout.taxBps', value: 1400, version: 1 },
    { key: 'checkout.requireCustomerPhone', value: false, version: 1 },
    { key: 'checkout.allowScheduledOrders', value: false, version: 1 },
    { key: 'receipt.footer', value: 'Thank you', version: 2 },
    { key: 'receipt.orderPrefix', value: 'TUX-', version: 1 },
    { key: 'receipt.sequenceStart', value: 1, version: 1 },
    { key: 'receipt.sequenceResetPolicy', value: 'BUSINESS_DAY', version: 1 },
  ],
  shopOverrides: [{ key: 'receipt.orderPrefix', value: 'MD-', version: 4 }],
  orderTypes: [
    {
      id: 'ot-1',
      name: 'Take Away',
      behavior: 'TAKE_AWAY',
      active: true,
      sortOrder: 10,
      editVersion: 3,
    },
    {
      id: 'ot-2',
      name: 'Delivery',
      behavior: 'DELIVERY',
      active: true,
      sortOrder: 20,
      editVersion: 4,
    },
  ],
  paymentMethods: [
    {
      id: 'pm-1',
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
    {
      id: 'pm-2',
      displayName: 'POS Card',
      logicType: 'CARD',
      requiresReconciliation: true,
      active: true,
      sortOrder: 20,
      channel: 'POS',
      requiresReference: true,
      manualConfirmationRequired: true,
      refundAllowed: true,
      integrationReference: 'terminal-1',
      editVersion: 6,
    },
  ],
  deliveryZones: [{ id: 'dz-1', name: 'Maadi', feeMinor: 3000, active: true, sortOrder: 10 }],
  reasonCodes: [
    {
      id: 'reason-1',
      scope: 'SHOP',
      key: 'CUSTOMER_CHANGED_MIND',
      family: 'CANCELLATION',
      label: 'Customer changed mind',
      active: true,
      version: 4,
    },
  ],
  weeklyHours: [
    {
      id: 'hours-1',
      serviceKind: 'OPEN',
      dayOfWeek: 1,
      timezone: 'Africa/Cairo',
      opensLocal: '10:00',
      closesLocal: '23:00',
      active: true,
    },
  ],
  specialHours: [],
};

const noop = vi.fn();

function renderSection(section: SettingsSection): string {
  return renderToStaticMarkup(
    <SettingsWorkspaceView
      workspace={workspace}
      section={section}
      onSectionChange={noop}
      onPublish={noop}
      publishing={false}
      onUpdateSettingOverride={noop}
      settingOverrideUpdating={false}
      onUpdateOrderType={noop}
      orderTypeUpdating={false}
      onUpdatePaymentMethod={noop}
      paymentMethodUpdating={false}
    />,
  );
}

describe('Settings workspace', () => {
  it('surfaces every Task 5 settings area from one concrete shop workspace', () => {
    const html = renderSection('overview');

    expect(html).toContain('TUX Maadi');
    expect(html).toContain('Live settings version 7');
    for (const label of [
      'Shop',
      'Order types',
      'Payments',
      'Checkout',
      'Receipts',
      'Reason codes',
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('Publish settings');
    expect(html).toContain('Changes become live only after publishing');
  });

  it('shows editable receipt inheritance without hiding the source layer', () => {
    const html = renderToStaticMarkup(
      <ReceiptsPage workspace={workspace} onUpdate={noop} updating={false} />,
    );
    expect(html).toContain('MD-');
    expect(html).toContain('Shop override');
    expect(html).toContain('Thank you');
    expect(html).toContain('Business default');
    expect(html).toContain('Sequence start');
    expect(html).toContain('Save Order prefix');
    expect(html).toContain('Save Receipt footer');
  });

  it('shows stable configured reason identity and version instead of free-text-only reasons', () => {
    const html = renderToStaticMarkup(<ReasonCodesPage workspace={workspace} />);
    expect(html).toContain('Customer changed mind');
    expect(html).toContain('CUSTOMER_CHANGED_MIND');
    expect(html).toContain('CANCELLATION');
    expect(html).toContain('v4');
  });

  it('renders real shop, fulfillment, payment and editable checkout configuration', () => {
    const shop = renderSection('shop');
    expect(shop).toContain('+201000000000');
    expect(shop).toContain('Road 9, Maadi');
    expect(shop).toContain('10:00');
    expect(shop).toContain('23:00');

    const orderTypes = renderSection('order-types');
    expect(orderTypes).toContain('Take Away');
    expect(orderTypes).toContain('TAKE_AWAY');
    expect(orderTypes).toContain('Delivery');
    expect(orderTypes).toContain('DELIVERY');
    expect(orderTypes).toContain('Edit Take Away');

    const payments = renderSection('payments');
    expect(payments).toContain('Cash');
    expect(payments).toContain('BOTH');
    expect(payments).toContain('POS Card');
    expect(payments).toContain('Reference required');
    expect(payments).toContain('Manual confirmation');
    expect(payments).toContain('Edit Cash');

    const checkout = renderSection('checkout');
    expect(checkout).toContain('Maadi');
    expect(checkout).toContain('30.00 EGP');
    expect(checkout).toContain('Minimum order (minor units)');
    expect(checkout).toContain('Service charge (bps)');
    expect(checkout).toContain('Tax / VAT (bps)');
    expect(checkout).toContain('1400');
    expect(checkout).toContain('Save Tax / VAT (bps)');
  });
});
