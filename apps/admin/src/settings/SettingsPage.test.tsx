import type { AdminSettingsWorkspace } from '@tux/admin-contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { SettingsWorkspaceView } from './SettingsPage';
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
    { key: 'receipt.footer', value: 'Thank you', version: 2 },
    { key: 'receipt.orderPrefix', value: 'TUX-', version: 1 },
    { key: 'receipt.sequenceStart', value: 1, version: 1 },
  ],
  shopOverrides: [{ key: 'receipt.orderPrefix', value: 'MD-', version: 4 }],
  orderTypes: [
    { id: 'ot-1', name: 'Take Away', behavior: 'TAKE_AWAY', active: true, sortOrder: 10 },
    { id: 'ot-2', name: 'Delivery', behavior: 'DELIVERY', active: true, sortOrder: 20 },
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
    },
  ],
  deliveryZones: [
    { id: 'dz-1', name: 'Maadi', feeMinor: 3000, active: true, sortOrder: 10 },
  ],
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

describe('Settings workspace', () => {
  it('surfaces every Task 5 settings area from one concrete shop workspace', () => {
    const html = renderToStaticMarkup(
      <SettingsWorkspaceView
        workspace={workspace}
        section="overview"
        onSectionChange={vi.fn()}
        onPublish={vi.fn()}
        publishing={false}
      />,
    );

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

  it('shows effective receipt inheritance without hiding the source layer', () => {
    const html = renderToStaticMarkup(<ReceiptsPage workspace={workspace} />);
    expect(html).toContain('MD-');
    expect(html).toContain('Shop override');
    expect(html).toContain('Thank you');
    expect(html).toContain('Business default');
    expect(html).toContain('Sequence start');
  });

  it('shows stable configured reason identity and version instead of free-text-only reasons', () => {
    const html = renderToStaticMarkup(<ReasonCodesPage workspace={workspace} />);
    expect(html).toContain('Customer changed mind');
    expect(html).toContain('CUSTOMER_CHANGED_MIND');
    expect(html).toContain('CANCELLATION');
    expect(html).toContain('v4');
  });
});
