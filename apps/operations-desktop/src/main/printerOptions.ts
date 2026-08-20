import type { ReceiptPrinterConfiguration } from '@tux/application';

export interface ElectronReceiptPrintOptions {
  readonly silent: true;
  readonly printBackground: false;
  readonly margins: { readonly marginType: 'none' };
  readonly usePrinterDefaultPageSize: true;
  readonly copies: number;
  readonly deviceName?: string;
}

export function electronPrintOptions(
  configuration: ReceiptPrinterConfiguration,
): ElectronReceiptPrintOptions | null {
  if (configuration.deviceName === null && !configuration.fallbackToDefault) return null;
  return {
    silent: true,
    printBackground: false,
    margins: { marginType: 'none' },
    usePrinterDefaultPageSize: true,
    copies: configuration.copyCount,
    ...(configuration.deviceName === null ? {} : { deviceName: configuration.deviceName }),
  };
}
