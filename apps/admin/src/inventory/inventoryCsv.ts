import type { AdminInventoryItem } from '@tux/admin-contracts';

import { inventoryStatus, trackingModeLabel } from './inventoryPresentation';

type ExportItem = Pick<
  AdminInventoryItem,
  | 'id'
  | 'name'
  | 'unitLabel'
  | 'trackingMode'
  | 'active'
  | 'onHandMicros'
  | 'reservedMicros'
  | 'availableMicros'
  | 'lowStockThresholdMicros'
>;

function exactMicros(value: number): string {
  if (!Number.isSafeInteger(value)) throw new Error('Invalid inventory export quantity');
  const absolute = BigInt(Math.abs(value));
  const integral = absolute / 1_000_000n;
  const fraction = (absolute % 1_000_000n).toString().padStart(6, '0');
  return `${value < 0 ? '-' : ''}${integral.toString()}.${fraction}`;
}

function safeCell(value: string): string {
  // Quote all CSV cells, escape internal quotes, and neutralize spreadsheet
  // formulas including those concealed by leading control/whitespace.
  const firstContent = [...value].find((character) => character.charCodeAt(0) > 32);
  const sanitized = firstContent && '=+-@'.includes(firstContent) ? `'${value}` : value;
  return `"${sanitized.replaceAll('"', '""')}"`;
}

/** Export only the authorized currently selected shop's real Inventory rows. */
export function inventoryCsv(items: readonly ExportItem[]): string {
  const header = [
    'Item',
    'Base unit',
    'Tracking mode',
    'On hand (base units)',
    'Reserved (base units)',
    'Available (base units)',
    'Low-stock threshold',
    'Status',
  ];
  const labels = {
    IN_STOCK: 'In stock',
    LOW_STOCK: 'Low stock',
    OUT_OF_STOCK: 'Out of stock',
    UNCONFIGURED: 'Threshold not set',
    ARCHIVED: 'Archived',
  } as const;
  return [
    header.map(safeCell).join(','),
    ...items.map((item) =>
      [
        item.name,
        item.unitLabel,
        trackingModeLabel(item.trackingMode),
        exactMicros(item.onHandMicros),
        exactMicros(item.reservedMicros),
        exactMicros(item.availableMicros),
        item.lowStockThresholdMicros === null
          ? 'Not configured'
          : exactMicros(item.lowStockThresholdMicros),
        labels[inventoryStatus(item)],
      ]
        .map(safeCell)
        .join(','),
    ),
    '',
  ].join('\r\n');
}
