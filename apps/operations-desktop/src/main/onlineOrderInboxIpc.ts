import type {
  OnlineOrderAcceptanceConfirmation,
  OnlineOrderInboxSnapshot,
  OperationsOnlineOrderAcceptanceService,
  OperationsOnlineOrderInboxService,
} from '@tux/application';
import {
  moneyMinor,
  parseEntityId,
  type DeliveryZoneId,
  type MoneyMinor,
  type OrderTypeId,
  type PaymentDraft,
  type PaymentMethodId,
} from '@tux/domain';
import { parseCachedOnlineOrderRequest } from '@tux/persistence';
import type { BrowserWindow } from 'electron';
import { ipcMain } from 'electron';
import { assertTrustedIpcSender } from './security';

export const IPC_ONLINE_ORDERS_LOAD = 'tux:online-orders:load';
export const IPC_ONLINE_ORDERS_CLAIM = 'tux:online-orders:claim';
export const IPC_ONLINE_ORDERS_RELEASE = 'tux:online-orders:release';
export const IPC_ONLINE_ORDERS_REJECT = 'tux:online-orders:reject';
export const IPC_ONLINE_ORDERS_ACCEPT = 'tux:online-orders:accept';
export const IPC_ONLINE_ORDERS_CHANGED = 'tux:online-orders:changed';

const MUTATION_CHANNELS = [
  IPC_ONLINE_ORDERS_LOAD,
  IPC_ONLINE_ORDERS_CLAIM,
  IPC_ONLINE_ORDERS_RELEASE,
  IPC_ONLINE_ORDERS_REJECT,
  IPC_ONLINE_ORDERS_ACCEPT,
] as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type OnlineOrderInboxService = Pick<
  OperationsOnlineOrderInboxService,
  'load' | 'claim' | 'release' | 'reject' | 'subscribe'
>;
type OnlineOrderAcceptanceService = Pick<OperationsOnlineOrderAcceptanceService, 'accept'>;

function objectPayload(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} IPC payload must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} IPC payload contains unexpected fields.`);
  }
}

function uuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a UUID.`);
  }
  return value;
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function nullableMoney(value: unknown, label: string): MoneyMinor | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer minor-unit amount or null.`);
  }
  return moneyMinor(value);
}

function paymentDraft(value: unknown): PaymentDraft {
  const payment = objectPayload(value, 'Online-order payment confirmation');
  const mode = payment['mode'];
  if (mode === 'NONE') {
    exactKeys(payment, ['mode'], 'Online-order payment confirmation');
    return { mode: 'NONE' };
  }
  if (mode === 'SINGLE') {
    exactKeys(
      payment,
      ['mode', 'methodId', 'cashReceivedMinor'],
      'Online-order payment confirmation',
    );
    return {
      mode: 'SINGLE',
      methodId: parseEntityId<PaymentMethodId>(
        uuid(payment['methodId'], 'Online-order payment method ID'),
      ),
      cashReceivedMinor: nullableMoney(payment['cashReceivedMinor'], 'Online-order cash received'),
    };
  }
  if (mode === 'SPLIT') {
    exactKeys(
      payment,
      ['mode', 'methodAId', 'amountAMinor', 'methodBId'],
      'Online-order payment confirmation',
    );
    const amountAMinor = nullableMoney(payment['amountAMinor'], 'Online-order split amount A');
    if (amountAMinor === null) {
      throw new TypeError('Online-order split amount A cannot be null.');
    }
    return {
      mode: 'SPLIT',
      methodAId: parseEntityId<PaymentMethodId>(
        uuid(payment['methodAId'], 'Online-order payment method A ID'),
      ),
      amountAMinor,
      methodBId: parseEntityId<PaymentMethodId>(
        uuid(payment['methodBId'], 'Online-order payment method B ID'),
      ),
    };
  }
  throw new TypeError('Online-order payment confirmation mode is invalid.');
}

function acceptanceConfirmation(value: unknown): OnlineOrderAcceptanceConfirmation {
  const confirmation = objectPayload(value, 'Online-order acceptance');
  exactKeys(
    confirmation,
    ['orderTypeId', 'deliveryZoneId', 'finalDeliveryFeeMinor', 'payment'],
    'Online-order acceptance',
  );
  const rawZoneId = confirmation['deliveryZoneId'];
  const deliveryZoneId =
    rawZoneId === null
      ? null
      : parseEntityId<DeliveryZoneId>(uuid(rawZoneId, 'Online-order delivery zone ID'));
  return {
    orderTypeId: parseEntityId<OrderTypeId>(
      uuid(confirmation['orderTypeId'], 'Online-order order type ID'),
    ),
    deliveryZoneId,
    finalDeliveryFeeMinor: nullableMoney(
      confirmation['finalDeliveryFeeMinor'],
      'Online-order final delivery fee',
    ),
    payment: paymentDraft(confirmation['payment']),
  };
}

export class OnlineOrderInboxIpcRuntime {
  readonly #service: OnlineOrderInboxService;
  readonly #acceptance: OnlineOrderAcceptanceService | null;
  #unsubscribe: (() => void) | null = null;

  constructor(input: {
    readonly service: OnlineOrderInboxService;
    readonly acceptance?: OnlineOrderAcceptanceService;
  }) {
    this.#service = input.service;
    this.#acceptance = input.acceptance ?? null;
  }

  register(window: BrowserWindow): void {
    this.close();

    ipcMain.handle(IPC_ONLINE_ORDERS_LOAD, async (event) => {
      assertTrustedIpcSender(event, window.webContents.id);
      return this.#service.load();
    });

    ipcMain.handle(IPC_ONLINE_ORDERS_CLAIM, async (event, rawInput: unknown) => {
      assertTrustedIpcSender(event, window.webContents.id);
      const input = objectPayload(rawInput, 'Online-order claim');
      exactKeys(input, ['requestId'], 'Online-order claim');
      return this.#service.claim(uuid(input['requestId'], 'Online-order request ID'));
    });

    ipcMain.handle(IPC_ONLINE_ORDERS_RELEASE, async (event, rawInput: unknown) => {
      assertTrustedIpcSender(event, window.webContents.id);
      const input = objectPayload(rawInput, 'Online-order release');
      exactKeys(input, ['requestId', 'processingOrderId'], 'Online-order release');
      return this.#service.release(
        uuid(input['requestId'], 'Online-order request ID'),
        uuid(input['processingOrderId'], 'Online-order processing order ID'),
      );
    });

    ipcMain.handle(IPC_ONLINE_ORDERS_REJECT, async (event, rawInput: unknown) => {
      assertTrustedIpcSender(event, window.webContents.id);
      const input = objectPayload(rawInput, 'Online-order rejection');
      exactKeys(input, ['requestId', 'processingOrderId', 'reason'], 'Online-order rejection');
      return this.#service.reject(
        uuid(input['requestId'], 'Online-order request ID'),
        uuid(input['processingOrderId'], 'Online-order processing order ID'),
        nonEmpty(input['reason'], 'Online-order rejection reason'),
      );
    });

    ipcMain.handle(IPC_ONLINE_ORDERS_ACCEPT, async (event, rawInput: unknown) => {
      assertTrustedIpcSender(event, window.webContents.id);
      const input = objectPayload(rawInput, 'Online-order acceptance');
      exactKeys(input, ['request', 'confirmation'], 'Online-order acceptance');
      if (this.#acceptance === null) {
        throw new Error('Online-order acceptance service is not configured.');
      }
      return this.#acceptance.accept(
        parseCachedOnlineOrderRequest(input['request']),
        acceptanceConfirmation(input['confirmation']),
      );
    });

    this.#unsubscribe = this.#service.subscribe((snapshot: OnlineOrderInboxSnapshot) => {
      if (window.isDestroyed()) return;
      window.webContents.send(IPC_ONLINE_ORDERS_CHANGED, snapshot);
    });
  }

  close(): void {
    for (const channel of MUTATION_CHANNELS) ipcMain.removeHandler(channel);
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }
}
