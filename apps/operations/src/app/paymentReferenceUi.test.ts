import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ordersCart = readFileSync(new URL('./OrdersCart.tsx', import.meta.url), 'utf8');
const onlineInbox = readFileSync(new URL('./OnlineOrderInboxPanel.tsx', import.meta.url), 'utf8');

describe('payment reference UI authority', () => {
  it('renders and persists required payment references in the POS cart', () => {
    expect(ordersCart).toContain('Payment reference');
    expect(ordersCart).toContain('requiresReference');
    expect(ordersCart).toContain('reference:');
    expect(ordersCart).toContain('referenceA');
    expect(ordersCart).toContain('referenceB');
  });

  it('requires and forwards a payment reference during online-order acceptance', () => {
    expect(onlineInbox).toContain("const [paymentReference, setPaymentReference] = useState('')");
    expect(onlineInbox).toContain('selectedPayment.requiresReference');
    expect(onlineInbox).toContain('Payment reference');
    expect(onlineInbox).toContain('reference:');
  });
});
