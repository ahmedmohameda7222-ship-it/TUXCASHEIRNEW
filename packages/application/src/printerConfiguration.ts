export type ReceiptPaperWidthMm = 58 | 80;

export interface ReceiptPrinterConfiguration {
  /** Electron system printer device name, not a display/friendly label. */
  readonly deviceName: string | null;
  readonly paperWidthMm: ReceiptPaperWidthMm;
  readonly copyCount: number;
  readonly fallbackToDefault: boolean;
}

export const DEFAULT_RECEIPT_PRINTER_CONFIGURATION: ReceiptPrinterConfiguration = {
  deviceName: null,
  paperWidthMm: 80,
  copyCount: 1,
  fallbackToDefault: true,
};

export function parseReceiptPrinterConfiguration(value: unknown): ReceiptPrinterConfiguration {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Printer configuration must be an object.');
  }
  const source = value as Record<string, unknown>;
  const rawDeviceName = source['deviceName'];
  if (
    rawDeviceName !== null &&
    (typeof rawDeviceName !== 'string' || rawDeviceName.trim().length === 0)
  ) {
    throw new TypeError('Printer deviceName must be a non-empty string or null.');
  }
  const paperWidthMm = source['paperWidthMm'];
  if (paperWidthMm !== 58 && paperWidthMm !== 80) {
    throw new TypeError('Receipt paperWidthMm must be 58 or 80.');
  }
  const copyCount = source['copyCount'];
  if (
    typeof copyCount !== 'number' ||
    !Number.isSafeInteger(copyCount) ||
    copyCount < 1 ||
    copyCount > 10
  ) {
    throw new TypeError('Printer copyCount must be a safe integer from 1 to 10.');
  }
  const fallbackToDefault = source['fallbackToDefault'];
  if (typeof fallbackToDefault !== 'boolean') {
    throw new TypeError('Printer fallbackToDefault must be a boolean.');
  }
  return {
    deviceName: rawDeviceName === null ? null : rawDeviceName.trim(),
    paperWidthMm,
    copyCount,
    fallbackToDefault,
  };
}
