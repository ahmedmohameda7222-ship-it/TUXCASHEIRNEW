import type { AdminOrderSummary } from '@tux/admin-contracts';

export const ORDER_EXPORT_MAX_ROWS = 1_000;

function cell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value);
  // A malicious customer or worker can place a spreadsheet formula in an
  // order-time name or label. Protect text, including leading whitespace.
  let index = 0;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code <= 32 || /\s/u.test(text[index] ?? '')) {
      index += 1;
      continue;
    }
    break;
  }
  if (/^[=+@-]/u.test(text.slice(index))) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function renderOrdersCsv(rows: readonly AdminOrderSummary[]): string {
  const header = [
    'Order reference',
    'Shop',
    'Business Day',
    'Display order',
    'Created at (UTC)',
    'Status',
    'Source',
    'Order type',
    'Operator',
    'Customer',
    'Phone',
    'Total minor (EGP)',
  ];
  const lines = rows
    .slice(0, ORDER_EXPORT_MAX_ROWS)
    .map((row) => [
      row.id,
      row.shopId,
      row.businessDayId ?? '',
      row.displayOrderNo,
      row.createdAt,
      row.status,
      row.source,
      row.orderTypeLabel,
      row.operatorName ?? '',
      row.customerName,
      row.normalizedPhone,
      row.totalMinor,
    ]);
  return (
    '\uFEFF' + [header, ...lines].map((line) => line.map(cell).join(',')).join('\r\n') + '\r\n'
  );
}
