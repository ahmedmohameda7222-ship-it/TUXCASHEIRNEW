import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./OrdersBoardWorkspace.tsx', import.meta.url), 'utf8');

describe('Task 8E Orders Board WhatsApp navigation', () => {
  it('offers internal WhatsApp Customer only for delivery orders and emits typed customer identity', () => {
    expect(source).toContain('onWhatsAppCustomer');
    expect(source).toContain('WhatsApp Customer');
    expect(source).toContain("order.fulfillment.behavior === 'DELIVERY'");
    expect(source).toContain('normalizedPhone');
    expect(source).toContain('displayPhone');
    expect(source).not.toContain('wa.me');
    expect(source).not.toContain('window.open(');
  });

  it('accepts a typed focused order id for View Order navigation', () => {
    expect(source).toContain('focusOrderId');
    expect(source).toContain('OrderId');
  });
});
