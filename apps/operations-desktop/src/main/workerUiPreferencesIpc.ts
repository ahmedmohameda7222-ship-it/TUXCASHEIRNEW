import type { OperationsSessionResult, WorkerUiPreferencesService } from '@tux/application';
import {
  parseEntityId,
  parseSystemAccentColor,
  type MenuCategoryId,
  type ProductId,
  type SystemAccentColor,
} from '@tux/domain';
import type { WorkerUiPreferencesRepository } from '@tux/persistence';
import type { TuxWorkerUiPreferencesApi } from '@tux/platform-contracts';
import type { BrowserWindow } from 'electron';
import { ipcMain } from 'electron';
import { assertTrustedIpcSender } from './security';

export const IPC_WORKER_UI_PREFERENCES_LOAD = 'tux:worker-ui-preferences:load';
export const IPC_WORKER_UI_PREFERENCES_CHANGED = 'tux:worker-ui-preferences:changed';
export const IPC_WORKER_UI_PREFERENCES_UPDATE_MENU_LAYOUT =
  'tux:worker-ui-preferences:update-menu-layout';
export const IPC_WORKER_UI_PREFERENCES_UPDATE_ACCENT = 'tux:worker-ui-preferences:update-accent';
export const IPC_WORKER_UI_PREFERENCES_RESET_MENU_LAYOUT =
  'tux:worker-ui-preferences:reset-menu-layout';

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

function parseMenuLayoutInput(
  value: unknown,
): Parameters<TuxWorkerUiPreferencesApi['updateMenuLayout']>[0] {
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

function parseAccentInput(value: unknown): SystemAccentColor | null {
  if (value === null) return null;
  const parsed = parseSystemAccentColor(value);
  if (parsed !== value) {
    throw new TypeError('Worker UI preference accent must use canonical uppercase HEX.');
  }
  return parsed;
}

export class WorkerUiPreferencesIpcRuntime implements TuxWorkerUiPreferencesApi {
  readonly #getSessionState: () => Promise<OperationsSessionResult>;
  readonly #repository: WorkerUiPreferencesRepository;
  readonly #service: WorkerUiPreferencesService;
  readonly #onChanged: (() => void) | undefined;
  #unsubscribe: (() => void) | null = null;

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

  subscribe(listener: Parameters<TuxWorkerUiPreferencesApi['subscribe']>[0]): () => void {
    return this.#service.subscribe(listener);
  }

  async updateMenuLayout(input: Parameters<TuxWorkerUiPreferencesApi['updateMenuLayout']>[0]) {
    const identity = await this.#activeIdentity();
    const updated = await this.#service.updateMenuLayout(identity.shopId, identity.workerId, input);
    this.#onChanged?.();
    return updated;
  }

  async updateAccentColor(accentColor: unknown) {
    const parsedAccent = parseAccentInput(accentColor);
    const identity = await this.#activeIdentity();
    const updated = await this.#service.updateAccentColor(
      identity.shopId,
      identity.workerId,
      parsedAccent,
    );
    this.#onChanged?.();
    return updated;
  }

  async resetMenuLayout(): Promise<void> {
    const identity = await this.#activeIdentity();
    await this.#service.updateMenuLayout(identity.shopId, identity.workerId, {
      categoryOrder: [],
      categoryAlignment: 'left',
      productOrder: [],
    });
    this.#onChanged?.();
  }

  register(window: BrowserWindow): void {
    for (const channel of [
      IPC_WORKER_UI_PREFERENCES_LOAD,
      IPC_WORKER_UI_PREFERENCES_UPDATE_MENU_LAYOUT,
      IPC_WORKER_UI_PREFERENCES_UPDATE_ACCENT,
      IPC_WORKER_UI_PREFERENCES_RESET_MENU_LAYOUT,
    ]) {
      ipcMain.removeHandler(channel);
    }
    this.#unsubscribe?.();
    this.#unsubscribe = this.#service.subscribe((preferences) => {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_WORKER_UI_PREFERENCES_CHANGED, preferences);
      }
    });

    ipcMain.handle(IPC_WORKER_UI_PREFERENCES_LOAD, async (event) => {
      assertTrustedIpcSender(event, window.webContents.id);
      return this.load();
    });
    ipcMain.handle(IPC_WORKER_UI_PREFERENCES_UPDATE_MENU_LAYOUT, async (event, input: unknown) => {
      assertTrustedIpcSender(event, window.webContents.id);
      return this.updateMenuLayout(parseMenuLayoutInput(input));
    });
    ipcMain.handle(IPC_WORKER_UI_PREFERENCES_UPDATE_ACCENT, async (event, accentColor: unknown) => {
      assertTrustedIpcSender(event, window.webContents.id);
      return this.updateAccentColor(accentColor);
    });
    ipcMain.handle(IPC_WORKER_UI_PREFERENCES_RESET_MENU_LAYOUT, async (event) => {
      assertTrustedIpcSender(event, window.webContents.id);
      await this.resetMenuLayout();
    });
  }

  close(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    for (const channel of [
      IPC_WORKER_UI_PREFERENCES_LOAD,
      IPC_WORKER_UI_PREFERENCES_UPDATE_MENU_LAYOUT,
      IPC_WORKER_UI_PREFERENCES_UPDATE_ACCENT,
      IPC_WORKER_UI_PREFERENCES_RESET_MENU_LAYOUT,
    ]) {
      ipcMain.removeHandler(channel);
    }
  }
}
