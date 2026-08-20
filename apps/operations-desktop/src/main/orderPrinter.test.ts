import {
  DEFAULT_RECEIPT_PRINTER_CONFIGURATION,
  type ReceiptPrinterConfiguration,
} from '@tux/application';
import { describe, expect, it } from 'vitest';
import { electronPrintOptions } from './printerOptions';

describe('Electron receipt printer mapping', () => {
  it('uses the configured system device and copy count when present', () => {
    const configuration: ReceiptPrinterConfiguration = {
      deviceName: 'Brother_QL_820NWB',
      paperWidthMm: 58,
      copyCount: 2,
      fallbackToDefault: false,
    };
    expect(electronPrintOptions(configuration)).toMatchObject({
      silent: true,
      deviceName: 'Brother_QL_820NWB',
      copies: 2,
      usePrinterDefaultPageSize: true,
    });
  });

  it('uses the OS default only when fallback is explicitly allowed', () => {
    expect(electronPrintOptions(DEFAULT_RECEIPT_PRINTER_CONFIGURATION)).not.toHaveProperty(
      'deviceName',
    );
    expect(
      electronPrintOptions({
        ...DEFAULT_RECEIPT_PRINTER_CONFIGURATION,
        fallbackToDefault: false,
      }),
    ).toBeNull();
  });
});
