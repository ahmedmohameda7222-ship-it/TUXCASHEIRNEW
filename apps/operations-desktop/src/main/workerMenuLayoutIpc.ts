import type { OperationsSessionResult, WorkerMenuLayoutService } from '@tux/application';
import { parseWorkerMenuLayout, type WorkerMenuLayout } from '@tux/domain';
import type { TuxWorkerMenuLayoutApi } from '@tux/platform-contracts';
import type { BrowserWindow } from 'electron';
import { ipcMain } from 'electron';
import { assertTrustedIpcSender } from './security';

export const IPC_WORKER_MENU_LAYOUT_LOAD = 'tux:worker-menu-layout:load';
export const IPC_WORKER_MENU_LAYOUT_CHANGED = 'tux:worker-menu-layout:changed';
export const IPC_WORKER_MENU_LAYOUT_UPDATE = 'tux:worker-menu-layout:update';
export const IPC_WORKER_MENU_LAYOUT_RESET = 'tux:worker-menu-layout:reset';
export const IPC_WORKER_MENU_LAYOUT_RETRY = 'tux:worker-menu-layout:retry';

interface WorkerMenuLayoutIpcRuntimeInput {
  readonly getSessionState: () => Promise<OperationsSessionResult>;
  readonly service: WorkerMenuLayoutService;
  readonly onChanged?: () => void;
}

function assertObjectPayload(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Worker Menu Layout IPC payload must be an object.');
  }
}

export class WorkerMenuLayoutIpcRuntime implements TuxWorkerMenuLayoutApi {
  readonly #getSessionState: () => Promise<OperationsSessionResult>;
  readonly #service: WorkerMenuLayoutService;
  readonly #onChanged: (() => void) | undefined;
  #unsubscribe: (() => void) | null = null;

  constructor(input: WorkerMenuLayoutIpcRuntimeInput) {
    this.#getSessionState = input.getSessionState;
    this.#service = input.service;
    this.#onChanged = input.onChanged;
  }

  async #activeIdentity() {
    const result = await this.#getSessionState();
    if (!result.ok || result.value.status !== 'ACTIVE') {
      throw new Error('Active worker session required.');
    }
    return {
      shopId: result.value.shopId,
      workerId: result.value.operator.id,
    };
  }

  async load(): Promise<WorkerMenuLayout | null> {
    const identity = await this.#activeIdentity();
    return this.#service.load(identity.shopId, identity.workerId);
  }

  subscribe(listener: Parameters<TuxWorkerMenuLayoutApi['subscribe']>[0]): () => void {
    return this.#service.subscribe(listener);
  }

  async updateMenuLayout(
    input: Parameters<TuxWorkerMenuLayoutApi['updateMenuLayout']>[0],
  ): Promise<WorkerMenuLayout> {
    assertObjectPayload(input);
    const identity = await this.#activeIdentity();
    const parsed = parseWorkerMenuLayout({
      shopId: identity.shopId,
      workerId: identity.workerId,
      categoryOrder: input['categoryOrder'],
      categoryAlignment: input['categoryAlignment'],
      productOrderByCategory: input['productOrderByCategory'],
      layoutVersion: 0,
      updatedAt: new Date().toISOString(),
      syncState: 'DIRTY',
    });
    const saved = await this.#service.updateMenuLayout(identity.shopId, identity.workerId, {
      categoryOrder: parsed.categoryOrder,
      categoryAlignment: parsed.categoryAlignment,
      productOrderByCategory: parsed.productOrderByCategory,
    });
    this.#onChanged?.();
    return saved;
  }

  async resetMenuLayout(): Promise<void> {
    const identity = await this.#activeIdentity();
    await this.#service.resetMenuLayout(identity.shopId, identity.workerId);
    this.#onChanged?.();
  }

  async retryActive(): Promise<void> {
    const identity = await this.#activeIdentity();
    await this.#service.syncOnce(identity.shopId, identity.workerId);
  }

  register(window: BrowserWindow): void {
    for (const channel of [
      IPC_WORKER_MENU_LAYOUT_LOAD,
      IPC_WORKER_MENU_LAYOUT_UPDATE,
      IPC_WORKER_MENU_LAYOUT_RESET,
      IPC_WORKER_MENU_LAYOUT_RETRY,
    ]) {
      ipcMain.removeHandler(channel);
    }
    this.#unsubscribe?.();
    this.#unsubscribe = this.#service.subscribe((layout) => {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_WORKER_MENU_LAYOUT_CHANGED, layout);
      }
    });

    ipcMain.handle(IPC_WORKER_MENU_LAYOUT_LOAD, async (event) => {
      assertTrustedIpcSender(event, window.webContents.id);
      return this.load();
    });
    ipcMain.handle(IPC_WORKER_MENU_LAYOUT_UPDATE, async (event, input: unknown) => {
      assertTrustedIpcSender(event, window.webContents.id);
      assertObjectPayload(input);
      return this.updateMenuLayout(
        input as Parameters<TuxWorkerMenuLayoutApi['updateMenuLayout']>[0],
      );
    });
    ipcMain.handle(IPC_WORKER_MENU_LAYOUT_RESET, async (event) => {
      assertTrustedIpcSender(event, window.webContents.id);
      await this.resetMenuLayout();
    });
    ipcMain.handle(IPC_WORKER_MENU_LAYOUT_RETRY, async (event) => {
      assertTrustedIpcSender(event, window.webContents.id);
      await this.retryActive();
    });
  }

  close(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    for (const channel of [
      IPC_WORKER_MENU_LAYOUT_LOAD,
      IPC_WORKER_MENU_LAYOUT_UPDATE,
      IPC_WORKER_MENU_LAYOUT_RESET,
      IPC_WORKER_MENU_LAYOUT_RETRY,
    ]) {
      ipcMain.removeHandler(channel);
    }
  }
}
