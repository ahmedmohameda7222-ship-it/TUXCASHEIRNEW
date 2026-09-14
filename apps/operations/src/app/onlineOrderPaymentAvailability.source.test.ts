import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const panelSource = readFileSync(new URL('./OnlineOrderInboxPanel.tsx', import.meta.url), 'utf8');
const paymentSource = readFileSync(
  new URL('../../../../packages/domain/src/payment.ts', import.meta.url),
  'utf8',
);

describe('online-order payment availability', () => {
  it('shares the trusted channel and delivery-zone predicates from the payment domain', () => {
    expect(paymentSource).toContain('export function paymentMethodSupportsChannel');
    expect(paymentSource).toContain('export function paymentMethodAllowedForDeliveryZone');
    expect(paymentSource).toContain("zoneRule?.allowed !== false");
  });

  it('only offers active payment methods that the ONLINE acceptance authority can accept', () => {
    expect(panelSource).toContain('paymentMethodSupportsChannel');
    expect(panelSource).toContain('paymentMethodAllowedForDeliveryZone');
    expect(panelSource).toMatch(/paymentMethodSupportsChannel\(method,\s*'ONLINE'\)/);
    expect(panelSource).toContain('workspace.configuration.settings?.paymentMethodZoneRules');
    expect(panelSource).toMatch(/method\.active\s*&&/);
  });
});
