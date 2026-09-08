import type { OnlineOrderInboxSnapshot, OperationsOnlineOrderInboxService } from '@tux/application';
import type { BrowserWindow } from 'electron';
import { ipcMain } from 'electron';
import { assertTrustedIpcSender } from './security';

export const IPC_ONLINE_ORDERS_LOAD = 'tux:online-orders:load';
export const IPC_ONLINE_ORDERS_CLAIM = 'tux:online-orders:claim';
export const IPC_ONLINE_ORDERS_RELEASE = 'tux:online-orders:release';
export const IPC_ONLINE_ORDERS_REJECT = 'tux:online-orders:reject';
export const IPC_ONLINE_ORDERS_CHANGED = 'tux:online-orders:changed';

const MUTATION_CHANNELS = [
  IPC_ONLINE_ORDERS_LOAD,
  IPC_ONLINE_ORDERS_CLAIM,
  IPC_ONLINE_ORDERS_RELEASE,
  IPC_ONLINE_ORDERS_REJECT,
] as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type OnlineOrderInboxService = Pick<
  OperationsOnlineOrderInboxService,
  'load' | 'claim' | 'release' | 'reject' | 'subscribe'
>;

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

export class OnlineOrderInboxIpcRuntime {
  readonly #service: OnlineOrderInboxService;
  #unsubscribe: (() => void) | null = null;

  constructor(input: { readonly service: OnlineOrderInboxService }) {
    this.#service = input.service;
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
