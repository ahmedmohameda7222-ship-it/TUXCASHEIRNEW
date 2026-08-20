import {
  DEFAULT_RECEIPT_PRINTER_CONFIGURATION,
  type OrderPrintAttempt,
  type OrderPrinter,
  type ReceiptPrinterConfiguration,
} from '@tux/application';
import type { OrderSnapshot } from '@tux/domain';
import { renderOrderReceiptHtml } from '@tux/printing';
import { BrowserWindow } from 'electron';
import { electronPrintOptions } from './printerOptions';

function testReceiptHtml(configuration: ReceiptPrinterConfiguration): string {
  const contentWidthMm = configuration.paperWidthMm - 8;
  return `<!doctype html>
<html>
<head><meta charset="utf-8" /><style>
@page { margin: 4mm; }
html, body { margin: 0; padding: 0; background: #fff; color: #000; font-family: Arial, sans-serif; }
body { width: ${contentWidthMm}mm; padding: 2mm; text-align: center; font-size: 11px; }
h1 { margin: 0 0 3mm; font-size: 20px; letter-spacing: 0.14em; }
</style></head>
<body><h1>TUX</h1><strong>Printer Test</strong><div>${configuration.paperWidthMm} mm receipt</div></body>
</html>`;
}

export class ElectronOrderPrinter implements OrderPrinter {
  readonly #configuration: ReceiptPrinterConfiguration;

  constructor(configuration = DEFAULT_RECEIPT_PRINTER_CONFIGURATION) {
    this.#configuration = configuration;
  }

  async print(order: OrderSnapshot): Promise<OrderPrintAttempt> {
    return this.#printHtml(
      renderOrderReceiptHtml(order, { paperWidthMm: this.#configuration.paperWidthMm }),
    );
  }

  /** Native/application boundary for future device-settings UI; it is intentionally not worker-facing. */
  async testPrint(): Promise<OrderPrintAttempt> {
    return this.#printHtml(testReceiptHtml(this.#configuration));
  }

  async #printHtml(html: string): Promise<OrderPrintAttempt> {
    const options = electronPrintOptions(this.#configuration);
    if (options === null) {
      return {
        ok: false,
        message: 'No receipt printer is configured and fallback to the OS default is disabled.',
      };
    }

    const receiptWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        javascript: false,
      },
    });

    try {
      await receiptWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      return await new Promise<OrderPrintAttempt>((resolve) => {
        receiptWindow.webContents.print(options, (success, failureReason) => {
          resolve(
            success
              ? { ok: true }
              : {
                  ok: false,
                  message: failureReason || 'The receipt printer rejected the print job.',
                },
          );
        });
      });
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'The receipt could not be printed.',
      };
    } finally {
      if (!receiptWindow.isDestroyed()) receiptWindow.destroy();
    }
  }
}
