import { OnlineOrderMutationLock } from '@tux/application';
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
  type ShopId,
} from '@tux/domain';
import type { CachedOnlineOrderRequest } from '@tux/persistence';
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
type OnlineOrderAcceptanceStore = {
  list(shopId: ShopId): Promise<readonly CachedOnlineOrderRequest[]>;
  get(shopId: ShopId, requestId: string): Promise<CachedOnlineOrderRequest | null>;
  markAccepted(shopId: ShopId, requestId: string, processingOrderId: string): Promise<void>;
};
type FindCommittedOnlineOrder = (shopId: ShopId, processingOrderId: string) => Promise<boolean>;

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
  readonly #acceptanceStore: OnlineOrderAcceptanceStore | null;
  readonly #getActiveShopId: (() => Promise<ShopId>) | null;
  readonly #findCommittedOnlineOrder: FindCommittedOnlineOrder | null;
  readonly #mutations = new OnlineOrderMutationLock();
  #unsubscribe: (() => void) | null = null;

  constructor(input: {
    readonly service: OnlineOrderInboxService;
    readonly acceptance?: OnlineOrderAcceptanceService;
    readonly acceptanceStore?: OnlineOrderAcceptanceStore;
    readonly getActiveShopId?: () => Promise<ShopId>;
    readonly findCommittedOnlineOrder?: FindCommittedOnlineOrder;
  }) {
    this.#service = input.service;
    this.#acceptance = input.acceptance ?? null;
    this.#acceptanceStore = input.acceptanceStore ?? null;
    this.#getActiveShopId = input.getActiveShopId ?? null;
    this.#findCommittedOnlineOrder = input.findCommittedOnlineOrder ?? null;
  }

  async #reconcileAcceptedOrders(requestId?: string): Promise<boolean> {
    if (
      this.#acceptanceStore === null ||
      this.#getActiveShopId === null ||
      this.#findCommittedOnlineOrder === null
    ) {
      return false;
    }
    const shopId = await this.#getActiveShopId();
    let requests: readonly CachedOnlineOrderRequest[];
    if (requestId === undefined) {
      requests = await this.#acceptanceStore.list(shopId);
    } else {
      const request = await this.#acceptanceStore.get(shopId, requestId);
      requests = request === null ? [] : [request];
    }
    let reconciled = false;
    for (const request of requests) {
      if (request.status !== 'PROCESSING' || request.processingOrderId === null) continue;
      if (await this.#findCommittedOnlineOrder(shopId, request.processingOrderId)) {
        await this.#acceptanceStore.markAccepted(
          shopId,
          request.requestId,
          request.processingOrderId,
        );
        reconciled = true;
      }
    }
    return reconciled;
  }

  register(window: BrowserWindow): void {
    this.close();

    ipcMain.handle(IPC_ONLINE_ORDERS_LOAD, async (event) => {
      assertTrustedIpcSender(event, window.webContents.id);
      await this.#reconcileAcceptedOrders();
      return this.#service.load();
    });

    ipcMain.handle(IPC_ONLINE_ORDERS_CLAIM, async (event, rawInput: unknown) => {
      assertTrustedIpcSender(event, window.webContents.id);
      const input = objectPayload(rawInput, 'Online-order claim');
      exactKeys(input, ['requestId'], 'Online-order claim');
      const requestId = uuid(input['requestId'], 'Online-order request ID');
      return this.#mutations.run(requestId, () => this.#service.claim(requestId));
    });

    ipcMain.handle(IPC_ONLINE_ORDERS_RELEASE, async (event, rawInput: unknown) => {
      assertTrustedIpcSender(event, window.webContents.id);
      const input = objectPayload(rawInput, 'Online-order release');
      exactKeys(input, ['requestId', 'processingOrderId'], 'Online-order release');
      const requestId = uuid(input['requestId'], 'Online-order request ID');
      const processingOrderId = uuid(
        input['processingOrderId'],
        'Online-order processing order ID',
      );
      return this.#mutations.run(requestId, async () => {
        if (await this.#reconcileAcceptedOrders(requestId)) {
          throw new Error('Online order has already been accepted locally.');
        }
        return this.#service.release(requestId, processingOrderId);
      });
    });

    ipcMain.handle(IPC_ONLINE_ORDERS_REJECT, async (event, rawInput: unknown) => {
      assertTrustedIpcSender(event, window.webContents.id);
      const input = objectPayload(rawInput, 'Online-order rejection');
      exactKeys(input, ['requestId', 'processingOrderId', 'reason'], 'Online-order rejection');
      const requestId = uuid(input['requestId'], 'Online-order request ID');
      const processingOrderId = uuid(
        input['processingOrderId'],
        'Online-order processing order ID',
      );
      const reason = nonEmpty(input['reason'], 'Online-order rejection reason');
      return this.#mutations.run(requestId, async () => {
        if (await this.#reconcileAcceptedOrders(requestId)) {
          throw new Error('Online order has already been accepted locally.');
        }
        return this.#service.reject(requestId, processingOrderId, reason);
      });
    });

    ipcMain.handle(IPC_ONLINE_ORDERS_ACCEPT, async (event, rawInput: unknown) => {
      assertTrustedIpcSender(event, window.webContents.id);
      const input = objectPayload(rawInput, 'Online-order acceptance');
      exactKeys(input, ['requestId', 'confirmation'], 'Online-order acceptance');
      const acceptance = this.#acceptance;
      const acceptanceStore = this.#acceptanceStore;
      const getActiveShopId = this.#getActiveShopId;
      if (acceptance === null || acceptanceStore === null || getActiveShopId === null) {
        throw new Error('Online-order acceptance service is not configured.');
      }
      const requestId = uuid(input['requestId'], 'Online-order request ID');
      const confirmation = acceptanceConfirmation(input['confirmation']);
      return this.#mutations.run(requestId, async () => {
        if (await this.#reconcileAcceptedOrders(requestId)) {
          throw new Error('Online order has already been accepted locally.');
        }
        const shopId = await getActiveShopId();
        const request = await acceptanceStore.get(shopId, requestId);
        if (
          request === null ||
          request.status !== 'PROCESSING' ||
          request.processingOrderId === null
        ) {
          throw new Error('A trusted PROCESSING online-order claim is required before acceptance.');
        }
        const result = await acceptance.accept(request, confirmation);
        if (result.ok) {
          await acceptanceStore.markAccepted(shopId, requestId, request.processingOrderId);
        }
        return result;
      });
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
