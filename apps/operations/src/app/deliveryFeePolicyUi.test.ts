import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ordersCart = readFileSync(new URL('./OrdersCart.tsx', import.meta.url), 'utf8');
const onlineInbox = readFileSync(new URL('./OnlineOrderInboxPanel.tsx', import.meta.url), 'utf8');

describe('delivery fee policy UI authority', () => {
  it('fails closed for POS manual delivery-fee editing', () => {
    expect(ordersCart).toContain(
      "configuration.settings?.values['checkout.allowDeliveryFeeOverride'] === true",
    );
    expect(ordersCart).toContain('disabled={busy || !allowDeliveryFeeOverride}');
    expect(ordersCart).toContain("'delivery.fee'");
  });

  it('defaults online acceptance to the selected zone fee and disables manual editing unless allowed', () => {
    expect(onlineInbox).toContain(
      "workspace.configuration.settings?.values['checkout.allowDeliveryFeeOverride'] === true",
    );
    expect(onlineInbox).toContain(
      "setFinalDeliveryFee(nextZone === undefined ? '' : minorInput(nextZone.feeMinor))",
    );
    expect(onlineInbox).toContain('disabled={busy || !allowDeliveryFeeOverride}');
  });
});
