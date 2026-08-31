import * as path from 'node:path';
import {
  WorkerMenuLayoutService,
  workerMenuLayoutUpdateFromFlatProductOrder,
  type OperationsSessionResult,
  type WorkerMenuLayoutRemoteGateway,
  type WorkerUiPreferencesService,
} from '@tux/application';
import {
  flattenWorkerMenuLayoutProductOrder,
  parseEntityId,
  parseSystemAccentColor,
  parseWorkerMenuLayout,
  parseWorkerUiPreferences,
  type MenuCategoryId,
  type ProductId,
  type SystemAccentColor,
  type WorkerMenuLayout,
  type WorkerUiPreferences,
} from '@tux/domain';
import type { WorkerUiPreferencesRepository } from '@tux/persistence';
import { SqliteWorkerMenuLayoutStore } from '@tux/persistence/sqlite';
import type { TuxWorkerMenuLayoutApi, TuxWorkerUiPreferencesApi } from '@tux/platform-contracts';
import type { BrowserWindow } from 'electron';
import { app, ipcMain } from 'electron';
import {
  createDesktopSupabaseDeviceSessionManager,
  SupabaseDesktopWorkerMenuLayoutGateway,
} from './automaticSync';
import { assertTrustedIpcSender } from './security';

export const IPC_WORKER_UI_PREFERENCES_LOAD = 'tux:worker-ui-preferences:load';
export const IPC_WORKER_UI_PREFERENCES_CHANGED = 'tux:worker-ui-preferences:changed';
export const IPC_WORKER_UI_PREFERENCES_UPDATE_MENU_LAYOUT =
  'tux:worker-ui-preferences:update-menu-layout';
export const IPC_WORKER_UI_PREFERENCES_UPDATE_ACCENT = 'tux:worker-ui-preferences:update-accent';
export const IPC_WORKER_UI_PREFERENCES_RESET_MENU_LAYOUT =
  'tux:worker-ui-preferences:reset-menu-layout';
export const IPC_WORKER_MENU_LAYOUT_LOAD = 'tux:worker-menu-layout:load';
export const IPC_WORKER_MENU_LAYOUT_CHANGED = 'tux:worker-menu-layout:changed';
export const IPC_WORKER_MENU_LAYOUT_UPDATE = 'tux:worker-menu-layout:update';
export const IPC_WORKER_MENU_LAYOUT_RESET = 'tux:worker-menu-layout:reset';
export const IPC_WORKER_MENU_LAYOUT_RETRY = 'tux:worker-menu-layout:retry';

interface WorkerUiPreferencesIpcRuntimeInput {
  readonly getSessionState: () => Promise<OperationsSessionResult>;
  readonly repository: WorkerUiPreferencesRepository;
  readonly service: WorkerUiPreferencesService;
  readonly onChanged?: () => void;
}

interface MenuRuntime {
  readonly store: SqliteWorkerMenuLayoutStore;
  readonly service: WorkerMenuLayoutService;
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

function unavailableWorkerMenuLayoutGateway(): WorkerMenuLayoutRemoteGateway {
  const unavailable = async (): Promise<never> => {
    throw new Error('Remote Worker Menu Layout sync is not configured.');
  };
  return {
    getWorkerMenuLayout: unavailable,
    putWorkerMenuLayout: unavailable,
  };
}

export class WorkerUiPreferencesIpcRuntime implements TuxWorkerUiPreferencesApi {
  readonly #getSessionState: () => Promise<OperationsSessionResult>;
  readonly #repository: WorkerUiPreferencesRepository;
  readonly #service: WorkerUiPreferencesService;
  readonly #onChanged: (() => void) | undefined;
  #unsubscribe: (() => void) | null = null;
  #menuUnsubscribe: (() => void) | null = null;
  #menuRuntimePromise: Promise<MenuRuntime> | null = null;
  #menuRetryTimer: ReturnType<typeof setInterval> | null = null;
  #registeredWindow: BrowserWindow | null = null;

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

  async #menuRuntime(): Promise<MenuRuntime> {
    this.#menuRuntimePromise ??= (async () => {
      const store = new SqliteWorkerMenuLayoutStore(
        path.join(app.getPath('userData'), 'tux-operations-v2.sqlite3'),
      );
      await store.initialize();
      const supabaseUrl = process.env['TUX_SUPABASE_URL']?.trim();
      const sessionManager = createDesktopSupabaseDeviceSessionManager();
      const gateway =
        supabaseUrl && sessionManager !== null
          ? new SupabaseDesktopWorkerMenuLayoutGateway({
              projectUrl: supabaseUrl,
              sessionManager,
            })
          : unavailableWorkerMenuLayoutGateway();
      const service = new WorkerMenuLayoutService(
        store,
        gateway,
        { getWorkerMenuLayoutCatalog: (shopId) => store.getCatalog(shopId) },
        () => new Date().toISOString() as WorkerMenuLayout['updatedAt'],
      );
      if (this.#menuRetryTimer === null) {
        this.#menuRetryTimer = setInterval(() => void this.retryActiveMenuLayout(), 60_000);
      }
      return { store, service };
    })();
    return this.#menuRuntimePromise;
  }

  async #compatiblePreferences(
    identity: Awaited<ReturnType<WorkerUiPreferencesIpcRuntime['#activeIdentity']>>,
    menuLayout?: WorkerMenuLayout | null,
    legacyPreferences?: WorkerUiPreferences | null,
  ): Promise<WorkerUiPreferences | null> {
    const legacy =
      legacyPreferences === undefined
        ? await this.#repository.get(identity.shopId, identity.workerId)
        : legacyPreferences;
    const menuRuntime = await this.#menuRuntime();
    const layout =
      menuLayout === undefined
        ? await menuRuntime.store.get(identity.shopId, identity.workerId)
        : menuLayout;
    if (legacy === null && layout === null) return null;
    return parseWorkerUiPreferences({
      shopId: identity.shopId,
      workerId: identity.workerId,
      categoryOrder: layout?.categoryOrder ?? legacy?.categoryOrder ?? [],
      categoryAlignment: layout?.categoryAlignment ?? legacy?.categoryAlignment ?? 'left',
      productOrder:
        layout === null || layout === undefined
          ? legacy?.productOrder ?? []
          : flattenWorkerMenuLayoutProductOrder(layout),
      accentColor: legacy?.accentColor ?? null,
      updatedAt: layout?.updatedAt ?? legacy?.updatedAt ?? new Date().toISOString(),
      serverVersion: legacy?.serverVersion ?? 0,
      syncState: layout?.syncState ?? legacy?.syncState ?? 'CLEAN',
    });
  }

  async load() {
    const identity = await this.#activeIdentity();
    const menuRuntime = await this.#menuRuntime();
    const layout = await menuRuntime.service.load(identity.shopId, identity.workerId);
    return this.#compatiblePreferences(identity, layout);
  }

  subscribe(listener: Parameters<TuxWorkerUiPreferencesApi['subscribe']>[0]): () => void {
    let active = true;
    const publish = async (): Promise<void> => {
      try {
        const identity = await this.#activeIdentity();
        const preferences = await this.#compatiblePreferences(identity);
        if (active && preferences !== null) listener(preferences);
      } catch {
        // Active-session fencing intentionally drops stale worker notifications.
      }
    };
    const unsubscribePreferences = this.#service.subscribe(() => void publish());
    void this.#menuRuntime().then((runtime) => {
      if (!active) return;
      const unsubscribeMenu = runtime.service.subscribe(() => void publish());
      const previous = this.#menuUnsubscribe;
      this.#menuUnsubscribe = () => {
        previous?.();
        unsubscribeMenu();
      };
    });
    return () => {
      active = false;
      unsubscribePreferences();
    };
  }

  async updateMenuLayout(input: Parameters<TuxWorkerUiPreferencesApi['updateMenuLayout']>[0]) {
    const identity = await this.#activeIdentity();
    const menuRuntime = await this.#menuRuntime();
    const isReset =
      input.categoryOrder.length === 0 &&
      input.productOrder.length === 0 &&
      input.categoryAlignment === 'left';
    const layout = isReset
      ? await menuRuntime.service.resetMenuLayout(identity.shopId, identity.workerId)
      : await menuRuntime.service.updateMenuLayout(
          identity.shopId,
          identity.workerId,
          workerMenuLayoutUpdateFromFlatProductOrder({
            categoryOrder: input.categoryOrder,
            categoryAlignment: input.categoryAlignment,
            productOrder: input.productOrder,
            catalog: await menuRuntime.store.getCatalog(identity.shopId),
          }),
        );
    return (await this.#compatiblePreferences(identity, layout))!;
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
    return (await this.#compatiblePreferences(identity, undefined, updated))!;
  }

  async resetMenuLayout(): Promise<void> {
    const identity = await this.#activeIdentity();
    const menuRuntime = await this.#menuRuntime();
    await menuRuntime.service.resetMenuLayout(identity.shopId, identity.workerId);
  }

  async loadWorkerMenuLayout(): Promise<WorkerMenuLayout | null> {
    const identity = await this.#activeIdentity();
    const menuRuntime = await this.#menuRuntime();
    return menuRuntime.service.load(identity.shopId, identity.workerId);
  }

  async updateWorkerMenuLayout(
    value: unknown,
  ): Promise<WorkerMenuLayout> {
    assertObjectPayload(value);
    const identity = await this.#activeIdentity();
    const parsed = parseWorkerMenuLayout({
      shopId: identity.shopId,
      workerId: identity.workerId,
      categoryOrder: value['categoryOrder'],
      categoryAlignment: value['categoryAlignment'],
      productOrderByCategory: value['productOrderByCategory'],
      layoutVersion: 0,
      updatedAt: new Date().toISOString(),
      syncState: 'DIRTY',
    });
    const menuRuntime = await this.#menuRuntime();
    return menuRuntime.service.updateMenuLayout(identity.shopId, identity.workerId, {
      categoryOrder: parsed.categoryOrder,
      categoryAlignment: parsed.categoryAlignment,
      productOrderByCategory: parsed.productOrderByCategory,
    });
  }

  async resetWorkerMenuLayout(): Promise<void> {
    const identity = await this.#activeIdentity();
    const menuRuntime = await this.#menuRuntime();
    await menuRuntime.service.resetMenuLayout(identity.shopId, identity.workerId);
  }

  async retryActiveMenuLayout(): Promise<void> {
    try {
      const identity = await this.#activeIdentity();
      const menuRuntime = await this.#menuRuntime();
      await menuRuntime.service.syncOnce(identity.shopId, identity.workerId);
    } catch {
      // Retry is best-effort. DIRTY local state remains authoritative until a later success.
    }
  }

  register(window: BrowserWindow): void {
    this.#registeredWindow = window;
    for (const channel of [
      IPC_WORKER_UI_PREFERENCES_LOAD,
      IPC_WORKER_UI_PREFERENCES_UPDATE_MENU_LAYOUT,
      IPC_WORKER_UI_PREFERENCES_UPDATE_ACCENT,
      IPC_WORKER_UI_PREFERENCES_RESET_MENU_LAYOUT,
      IPC_WORKER_MENU_LAYOUT_LOAD,
      IPC_WORKER_MENU_LAYOUT_UPDATE,
      IPC_WORKER_MENU_LAYOUT_RESET,
      IPC_WORKER_MENU_LAYOUT_RETRY,
    ]) {
      ipcMain.removeHandler(channel);
    }
    this.#unsubscribe?.();
    this.#menuUnsubscribe?.();
    this.#menuUnsubscribe = null;
    this.#unsubscribe = this.#service.subscribe(() => {
      void this.#publishCompatiblePreferences();
    });
    void this.#menuRuntime().then((runtime) => {
      if (this.#registeredWindow !== window || window.isDestroyed()) return;
      this.#menuUnsubscribe = runtime.service.subscribe((layout) => {
        if (!window.isDestroyed()) {
          window.webContents.send(IPC_WORKER_MENU_LAYOUT_CHANGED, layout);
        }
        void this.#publishCompatiblePreferences();
      });
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
    ipcMain.handle(IPC_WORKER_MENU_LAYOUT_LOAD, async (event) => {
      assertTrustedIpcSender(event, window.webContents.id);
      return this.loadWorkerMenuLayout();
    });
    ipcMain.handle(IPC_WORKER_MENU_LAYOUT_UPDATE, async (event, input: unknown) => {
      assertTrustedIpcSender(event, window.webContents.id);
      return this.updateWorkerMenuLayout(input);
    });
    ipcMain.handle(IPC_WORKER_MENU_LAYOUT_RESET, async (event) => {
      assertTrustedIpcSender(event, window.webContents.id);
      await this.resetWorkerMenuLayout();
    });
    ipcMain.handle(IPC_WORKER_MENU_LAYOUT_RETRY, async (event) => {
      assertTrustedIpcSender(event, window.webContents.id);
      await this.retryActiveMenuLayout();
    });
  }

  async #publishCompatiblePreferences(): Promise<void> {
    const window = this.#registeredWindow;
    if (window === null || window.isDestroyed()) return;
    try {
      const identity = await this.#activeIdentity();
      const preferences = await this.#compatiblePreferences(identity);
      if (preferences !== null && !window.isDestroyed()) {
        window.webContents.send(IPC_WORKER_UI_PREFERENCES_CHANGED, preferences);
      }
    } catch {
      // Active-session fencing intentionally drops stale notifications.
    }
  }

  close(): void {
    this.#registeredWindow = null;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#menuUnsubscribe?.();
    this.#menuUnsubscribe = null;
    if (this.#menuRetryTimer !== null) {
      clearInterval(this.#menuRetryTimer);
      this.#menuRetryTimer = null;
    }
    void this.#menuRuntimePromise?.then((runtime) => runtime.store.close());
    for (const channel of [
      IPC_WORKER_UI_PREFERENCES_LOAD,
      IPC_WORKER_UI_PREFERENCES_UPDATE_MENU_LAYOUT,
      IPC_WORKER_UI_PREFERENCES_UPDATE_ACCENT,
      IPC_WORKER_UI_PREFERENCES_RESET_MENU_LAYOUT,
      IPC_WORKER_MENU_LAYOUT_LOAD,
      IPC_WORKER_MENU_LAYOUT_UPDATE,
      IPC_WORKER_MENU_LAYOUT_RESET,
      IPC_WORKER_MENU_LAYOUT_RETRY,
    ]) {
      ipcMain.removeHandler(channel);
    }
  }
}
