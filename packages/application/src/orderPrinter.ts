import type { OrderSnapshot } from '@tux/domain';

export type OrderPrintAttempt =
  { readonly ok: true } | { readonly ok: false; readonly message: string };

export interface OrderPrinter {
  print(order: OrderSnapshot): Promise<OrderPrintAttempt>;
}

export const unavailableOrderPrinter: OrderPrinter = {
  print: async () => ({ ok: false, message: 'Receipt printing is unavailable on this runtime.' }),
};
