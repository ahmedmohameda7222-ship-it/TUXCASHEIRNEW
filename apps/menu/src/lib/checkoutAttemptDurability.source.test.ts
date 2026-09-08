import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const drawerSource = readFileSync(
  new URL('../components/cart/CartDrawer.tsx', import.meta.url),
  'utf8',
);
const cartSource = readFileSync(new URL('../context/CartContext.tsx', import.meta.url), 'utf8');

describe('checkout completion durability', () => {
  it('durably empties the persisted cart before clearing the checkout idempotency key', () => {
    const clearCartBody = cartSource.match(/const clearCart = \(\) => \{[\s\S]*?\n  \};/)?.[0];
    expect(clearCartBody).toBeDefined();
    expect(clearCartBody).toContain("localStorage.setItem('tux-cart', JSON.stringify([]))");
    expect(
      clearCartBody!.indexOf("localStorage.setItem('tux-cart', JSON.stringify([]))"),
    ).toBeLessThan(clearCartBody!.indexOf('setItems([])'));

    const checkoutSuccess = drawerSource.match(
      /setPendingRequestId\(response\.requestId\);[\s\S]*?clearCart\(\);[\s\S]*?clearPendingCheckoutAttempt\(\);/,
    )?.[0];
    expect(checkoutSuccess).toBeDefined();
    expect(checkoutSuccess!.indexOf('clearCart();')).toBeLessThan(
      checkoutSuccess!.indexOf('clearPendingCheckoutAttempt();'),
    );
  });
});
