import { describe, expect, it } from 'vitest';
import type { AdminOrderSummary } from '@tux/admin-contracts';

import { ORDER_EXPORT_MAX_ROWS, renderOrdersCsv } from './orderCsvExport';

const row: AdminOrderSummary = {
  id: '11111111-1111-4111-8111-111111111111',
  shopId: '22222222-2222-4222-8222-222222222222',
  businessDayId: '33333333-3333-4333-8333-333333333333',
  displayOrderNo: 42,
  displayOrderLabel: '#42',
  createdAt: '2026-10-25T12:00:00.000Z',
  status: 'DONE',
  source: 'POS',
  operationalRevision: 1,
  orderTypeLabel: 'Take away',
  operatorName: '@External',
  customerName: '=1+1',
  normalizedPhone: '+201000000000',
  totalMinor: 8000,
};

describe('Orders CSV export', () => {
  it('protects customer, phone and operator cells against spreadsheet formula injection', () => {
    const csv = renderOrdersCsv([row]);
    expect(csv).toContain('"\'=1+1"');
    expect(csv).toContain('"\'@External"');
    expect(csv).toContain('"\'+201000000000"');
    expect(csv).toContain('"33333333-3333-4333-8333-333333333333"');
    expect(csv).toContain('"8000"');
  });

  it('escapes embedded quote marks, newlines, and a leading formula after whitespace', () => {
    const csv = renderOrdersCsv([{ ...row, customerName: '  =HYPERLINK("x")\nother' }]);
    expect(csv).toContain('"\'  =HYPERLINK(""x"")\nother"');
  });

  it('bounds total exported rows to the server-side limit', () => {
    const csv = renderOrdersCsv(Array.from({ length: ORDER_EXPORT_MAX_ROWS + 10 }, () => row));
    expect(csv.split('\r\n').length).toBe(ORDER_EXPORT_MAX_ROWS + 2);
  });
});
