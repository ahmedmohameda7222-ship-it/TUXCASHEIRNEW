import type { OrderPrintAttempt, OrderPrinter } from '@tux/application';
import type { OrderSnapshot } from '@tux/domain';
import { renderOrderReceiptHtml } from '@tux/printing';
import { BrowserWindow } from 'electron';

export class ElectronOrderPrinter implements OrderPrinter {
  async print(order: OrderSnapshot): Promise<OrderPrintAttempt> {
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
      const html = renderOrderReceiptHtml(order);
      await receiptWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      return await new Promise<OrderPrintAttempt>((resolve) => {
        receiptWindow.webContents.print(
          {
            silent: true,
            printBackground: false,
            margins: { marginType: 'none' },
            usePrinterDefaultPageSize: true,
          },
          (success, failureReason) => {
            resolve(
              success
                ? { ok: true }
                : {
                    ok: false,
                    message: failureReason || 'The receipt printer rejected the print job.',
                  },
            );
          },
        );
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
