import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RECEIPT_PRINTER_CONFIGURATION,
  parseReceiptPrinterConfiguration,
} from './printerConfiguration';

describe('receipt printer configuration', () => {
  it('keeps an explicit device, paper width, copy count and fallback policy', () => {
    expect(
      parseReceiptPrinterConfiguration({
        deviceName: '  Brother_QL_820NWB  ',
        paperWidthMm: 58,
        copyCount: 2,
        fallbackToDefault: false,
      }),
    ).toEqual({
      deviceName: 'Brother_QL_820NWB',
      paperWidthMm: 58,
      copyCount: 2,
      fallbackToDefault: false,
    });
    expect(DEFAULT_RECEIPT_PRINTER_CONFIGURATION.fallbackToDefault).toBe(true);
  });

  it('rejects ambiguous or unsafe printer settings', () => {
    expect(() =>
      parseReceiptPrinterConfiguration({
        deviceName: '',
        paperWidthMm: 80,
        copyCount: 1,
        fallbackToDefault: true,
      }),
    ).toThrow();
    expect(() =>
      parseReceiptPrinterConfiguration({
        deviceName: null,
        paperWidthMm: 76,
        copyCount: 1,
        fallbackToDefault: true,
      }),
    ).toThrow();
    expect(() =>
      parseReceiptPrinterConfiguration({
        deviceName: null,
        paperWidthMm: 80,
        copyCount: 0,
        fallbackToDefault: true,
      }),
    ).toThrow();
  });
});
