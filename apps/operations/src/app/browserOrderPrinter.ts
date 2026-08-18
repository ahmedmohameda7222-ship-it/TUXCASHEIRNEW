import type { OrderPrintAttempt, OrderPrinter } from '@tux/application';
import type { OrderSnapshot } from '@tux/domain';
import { renderOrderReceiptHtml } from '@tux/printing';

export class BrowserOrderPrinter implements OrderPrinter {
  async print(order: OrderSnapshot): Promise<OrderPrintAttempt> {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.position = 'fixed';
    frame.style.width = '1px';
    frame.style.height = '1px';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.border = '0';
    frame.style.opacity = '0';

    try {
      const loaded = new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('Receipt document did not load.')), 5_000);
        frame.addEventListener(
          'load',
          () => {
            window.clearTimeout(timeout);
            resolve();
          },
          { once: true },
        );
      });

      frame.srcdoc = renderOrderReceiptHtml(order);
      document.body.append(frame);
      await loaded;

      const printWindow = frame.contentWindow;
      if (printWindow === null) {
        return { ok: false, message: 'The browser could not open the receipt print document.' };
      }

      printWindow.focus();
      printWindow.print();
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'The receipt could not be printed.',
      };
    } finally {
      frame.remove();
    }
  }
}
