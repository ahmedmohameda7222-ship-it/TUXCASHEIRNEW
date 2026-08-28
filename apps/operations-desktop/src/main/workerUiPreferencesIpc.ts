import type { OperationsSessionResult, WorkerUiPreferencesService } from '@tux/application';
import { parseEntityId, type MenuCategoryId, type ProductId } from '@tux/domain';
import type { WorkerUiPreferencesRepository } from '@tux/persistence';
import type { TuxWorkerUiPreferencesApi } from '@tux/platform-contracts';
import type { BrowserWindow } from 'electron';
import { ipcMain } from 'electron';
import { assertTrustedIpcSender } from './security';

export const IPC_WORKER_UI_PREFERENCES_LOAD = 'tux:worker-ui-preferences:load';
export const IPC_WORKER_UI_PREFERENCES_UPDATE = 'tux:worker-ui-preferences:update';
export const IPC_WORKER_UI_PREFERENCES_RESET = 'tux:worker-ui-preferences:reset';

interface WorkerUiPreferencesIpcRuntimeInput {
  readonly getSessionState: () => Promise<OperationsSessionResult>;
  readonly repository: WorkerUiPreferencesRepository;
  readonly service: WorkerUiPreferencesService;
  readonly onChanged?: () => void;
}

function assertObjectPayload(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Worker UI preference IPC payload must be an object.');
  }
}

function parseUpdateInput(value: unknown): Parameters<TuxWorkerUiPreferencesApi['update']>[0] {
  assertObjectPayload(value);
  const categoryOrder = value['categoryOrder'];
  const categoryAlignment = value['categoryAlignment'];
  const productOrder = value['productOrder'];
  if (
    !Array.isArray(categoryOrder) ||
    !Array.isArray(productOrder) ||
    (categoryAlignment !== 'left' &&
      categoryAlignment !== 'center' &&
      categoryAlignment !== 'right')
  ) {
    throw new TypeError('Worker UI preference IPC payload is invalid.');
  }
  return {
    categoryOrder: categoryOrder.map((categoryId) => {
      if (typeof categoryId !== 'string') {
        throw new TypeError('Worker UI preference category IDs must be strings.');
      }
      return parseEntityId<MenuCategoryId>(categoryId);
    }),
    categoryAlignment,
    productOrder: productOrder.map((productId) => {
      if (typeof productId !== 'string') {
        throw new TypeError('Worker UI preference product IDs must be strings.');
      }
      return parseEntityId<ProductId>(productId);
    }),
  };
}

export class WorkerUiPreferencesIpcRuntime implements TuxWorkerUiPreferencesApi {
  readonly #getSessionState: () => Promise<OperationsSessionResult>;
  readonly #repository: WorkerUiPreferencesRepository;
  readonly #service: WorkerUiPreferencesService;
  readonly #onChanged: (() => void) | undefined;

  constructor(input: WorkerUiPreferencesIpcRuntimeInput) {
    this.#getSessionState = input.getSessionState;
    this.#repository = input.repository;
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

  async load() {
    const identity = await this.#activeIdentity();
    return this.#repository.get(identity.shopId, identity.workerId);
  }

  async update(input: Parameters<TuxWorkerUiPreferencesApi['update']>[0]) {
    const identity = await this.#activeIdentity();
    const updated = await this.#service.update(identity.shopId, identity.workerId, input);
    this.#onChanged?.();
    return updated;
  }

  async reset(): Promise<void> {
    await this.update({ categoryOrder: [], categoryAlignment: 'left', productOrder: [] });
  }

  register(window: BrowserWindow): void {
    for (const channel of [
      IPC_WORKER_UI_PREFERENCES_LOAD,
      IPC_WORKER_UI_PREFERENCES_UPDATE,
      IPC_WORKER_UI_PREFERENCES_RESET,
    ]) {
      ipcMain.removeHandler(channel);
    }

    ipcMain.handle(IPC_WORKER_UI_PREFERENCES_LOAD, async (event) => {
      assertTrustedIpcSender(event, window.webContents.id);
      return this.load();
    });
    ipcMain.handle(IPC_WORKER_UI_PREFERENCES_UPDATE, async (event, input: unknown) => {
      assertTrustedIpcSender(event, window.webContents.id);
      return this.update(parseUpdateInput(input));
    });
    ipcMain.handle(IPC_WORKER_UI_PREFERENCES_RESET, async (event) => {
      assertTrustedIpcSender(event, window.webContents.id);
      await this.reset();
    });
  }

  close(): void {
    for (const channel of [
      IPC_WORKER_UI_PREFERENCES_LOAD,
      IPC_WORKER_UI_PREFERENCES_UPDATE,
      IPC_WORKER_UI_PREFERENCES_RESET,
    ]) {
      ipcMain.removeHandler(channel);
    }
  }
}
