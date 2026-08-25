import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import {
  ApplicationCommandCoordinator,
  CoordinatedOperationsSessionService,
  OperationsConfigurationSyncService,
  OperationsOrdersBoardService,
  OperationsOrdersService,
  WorkerUiPreferencesRetryController,
  WorkerUiPreferencesService,
  type OperationsSessionResult,
  type WorkerUiPreferencesSyncIdentity,
} from '@tux/application';
import { instant, parseEntityId, parseOrderDraft, type OrderId, type ShopId } from '@tux/domain';
import type { WorkerUiPreferencesRepository } from '@tux/persistence';
import {
  SqliteOperationsDatabase,
  SqliteOperatorSessionReadModel,
  SqliteOrderDraftStore,
} from '@tux/persistence/sqlite';
import type { TuxSyncHealthSnapshot } from '@tux/platform-contracts';
import {
  buildSyncHealth,
  SupabaseInboundConfigurationProvider,
  type AutomaticOutboxScheduler,
  type OutboxSyncSummary,
} from '@tux/sync';
import { app, BrowserWindow, ipcMain } from 'electron';
import {
  createDesktopSupabaseDeviceSessionManager,
  ensureDesktopSupabaseDeviceSession,
  startDesktopAutomaticSync,
  SupabaseDesktopWorkerUiPreferencesGateway,
} from './automaticSync';
import { BulkStockIpcRuntime } from './bulkStockIpc';
import { EndDayIpcRuntime } from './endDayIpc';
import { ExpensesIpcRuntime } from './expensesIpc';
import { ElectronOrderPrinter } from './orderPrinter';
import { NodePbkdf2PinVerifier } from './pinVerifier';
import {
  assertTrustedIpcSender,
  createSecureWebPreferences,
  parseLoopbackDevelopmentUrl,
} from './security';

const IPC_GET_APP_VERSION = 'tux:app:get-version';
const IPC_SESSION_GET_STATE = 'tux:session:get-state';
const IPC_SESSION_SUBMIT_PIN = 'tux:session:submit-pin';
const IPC_SESSION_SIGN_OUT = 'tux:session:sign-out';
const IPC_SYNC_GET_STATUS = 'tux:sync:get-status';
const IPC_SYNC_STATUS_CHANGED = 'tux:sync:status-changed';
const IPC_ORDERS_LOAD_WORKSPACE = 'tux:orders:load-workspace';
const IPC_ORDERS_SAVE_DRAFT = 'tux:orders:save-draft';
const IPC_ORDERS_FIND_CUSTOMER = 'tux:orders:find-customer';
const IPC_ORDERS_PLACE = 'tux:orders:place';
const IPC_ORDERS_REPRINT = 'tux:orders:reprint';
const IPC_BOARD_LOAD = 'tux:orders-board:load';
const IPC_BOARD_MARK_DONE = 'tux:orders-board:mark-done';
const IPC_BOARD_UNDO_DONE = 'tux:orders-board:undo-done';
const IPC_BOARD_CANCEL = 'tux:orders-board:cancel';
const IPC_BOARD_RETURN = 'tux:orders-board:return';

let operationsDatabase: SqliteOperationsDatabase | null = null;
let operatorReadModel: SqliteOperatorSessionReadModel | null = null;
let orderDraftStore: SqliteOrderDraftStore | null = null;
let sessionService: CoordinatedOperationsSessionService | null = null;
let ordersService: OperationsOrdersService | null = null;
let ordersBoardService: OperationsOrdersBoardService | null = null;
let expensesIpcRuntime: ExpensesIpcRuntime | null = null;
let bulkStockIpcRuntime: BulkStockIpcRuntime | null = null;
let endDayIpcRuntime: EndDayIpcRuntime | null = null;
let automaticSyncScheduler: AutomaticOutboxScheduler | null = null;
let workerUiPreferencesRetry: WorkerUiPreferencesRetryController | null = null;
let activeWorkerUiPreferencesIdentity: WorkerUiPreferencesSyncIdentity | null = null;
let configurationSyncTimer: ReturnType<typeof setInterval> | null = null;
let syncHealthSnapshot = buildSyncHealth({ remoteConfigured: false }) as TuxSyncHealthSnapshot;
let syncHasRun = false;
let syncLastResult: OutboxSyncSummary | Error | null = null;

function assertObjectPayload(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} IPC payload must be an object.`);
  }
}

function updateSyncHealth(input: Parameters<typeof buildSyncHealth>[0]): void {
  syncHealthSnapshot = buildSyncHealth(input) as TuxSyncHealthSnapshot;
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC_SYNC_STATUS_CHANGED, syncHealthSnapshot);
  }
}

function trackWorkerUiPreferencesIdentity(result: OperationsSessionResult): void {
  if (!result.ok || result.value.status !== 'ACTIVE') {
    activeWorkerUiPreferencesIdentity = null;
    return;
  }
  activeWorkerUiPreferencesIdentity = {
    shopId: result.value.shopId,
    workerId: result.value.operator.id,
  };
  void workerUiPreferencesRetry?.syncActive();
}

async function initializeOperationsServices(): Promise<void> {
  const databasePath = path.join(app.getPath('userData'), 'tux-operations-v2.sqlite3');
  operationsDatabase = new SqliteOperationsDatabase(databasePath);
  await operationsDatabase.initialize();

  orderDraftStore = new SqliteOrderDraftStore(databasePath);
  await orderDraftStore.initialize();
  operatorReadModel = new SqliteOperatorSessionReadModel(databasePath);

  const runtime = {
    now: () => instant(new Date()),
    createUuid: () => randomUUID(),
  };
  const coordinator = new ApplicationCommandCoordinator();
  const remoteSessionManager = createDesktopSupabaseDeviceSessionManager();
  const supabaseUrl = process.env['TUX_SUPABASE_URL']?.trim();
  if (remoteSessionManager !== null && supabaseUrl) {
    const configurationService = new OperationsConfigurationSyncService(
      operationsDatabase,
      coordinator,
      new SupabaseInboundConfigurationProvider({
        projectUrl: supabaseUrl,
        session: remoteSessionManager,
      }),
    );
    const synchronizeConfiguration = async () => {
      try {
        const remoteSession = await ensureDesktopSupabaseDeviceSession(remoteSessionManager);
        const result = await configurationService.sync(remoteSession.shopId);
        if (
          result.status === 'INVALID_REMOTE_CONFIGURATION' ||
          result.status === 'LOCAL_PERSISTENCE_ERROR'
        ) {
          console.error(`TUX remote configuration ${result.status}: ${result.message}`);
        }
      } catch (cause) {
        console.warn(
          'TUX remote configuration is unavailable; using the last known-good local snapshot.',
          cause,
        );
      }
    };
    await synchronizeConfiguration();
    configurationSyncTimer = setInterval(() => void synchronizeConfiguration(), 5 * 60 * 1000);
  }

  sessionService = new CoordinatedOperationsSessionService(
    operationsDatabase,
    operatorReadModel,
    new NodePbkdf2PinVerifier(),
    runtime,
    coordinator,
  );

  if (remoteSessionManager !== null && supabaseUrl) {
    const preferencesRepository: WorkerUiPreferencesRepository = {
      get: (shopId, workerId) =>
        operationsDatabase!.transaction((transaction) =>
          transaction.workerUiPreferences.get(shopId, workerId),
        ),
      put: (preferences) =>
        operationsDatabase!.transaction((transaction) =>
          transaction.workerUiPreferences.put(preferences),
        ),
      delete: (shopId, workerId) =>
        operationsDatabase!.transaction((transaction) =>
          transaction.workerUiPreferences.delete(shopId, workerId),
        ),
    };
    const preferencesService = new WorkerUiPreferencesService(
      preferencesRepository,
      new SupabaseDesktopWorkerUiPreferencesGateway({
        projectUrl: supabaseUrl,
        sessionManager: remoteSessionManager,
      }),
      runtime.now,
    );
    workerUiPreferencesRetry = new WorkerUiPreferencesRetryController(
      preferencesService,
      () => activeWorkerUiPreferencesIdentity,
    );
    workerUiPreferencesRetry.start();
    trackWorkerUiPreferencesIdentity(await sessionService.getState());
  }

  ordersService = new OperationsOrdersService(
    operationsDatabase,
    operatorReadModel,
    orderDraftStore,
    runtime,
    coordinator,
    new ElectronOrderPrinter(),
  );
  ordersBoardService = new OperationsOrdersBoardService(
    operationsDatabase,
    operatorReadModel,
    runtime,
    coordinator,
  );
  expensesIpcRuntime = await ExpensesIpcRuntime.create({
    databasePath,
    database: operationsDatabase,
    readModel: operatorReadModel,
    runtime,
    coordinator,
  });
  bulkStockIpcRuntime = await BulkStockIpcRuntime.create({
    databasePath,
    database: operationsDatabase,
    readModel: operatorReadModel,
    runtime,
    coordinator,
  });
  endDayIpcRuntime = await EndDayIpcRuntime.create({
    databasePath,
    database: operationsDatabase,
    readModel: operatorReadModel,
    draftStore: orderDraftStore,
    runtime,
    coordinator,
  });

  syncHasRun = false;
  syncLastResult = null;
  updateSyncHealth({ remoteConfigured: false });
  automaticSyncScheduler = startDesktopAutomaticSync({
    database: operationsDatabase,
    now: runtime.now,
    ...(remoteSessionManager === null ? {} : { sessionManager: remoteSessionManager }),
    onConfigured: () => updateSyncHealth({ remoteConfigured: true }),
    onStart: () =>
      updateSyncHealth({
        remoteConfigured: true,
        syncing: true,
        hasRun: syncHasRun,
        lastResult: syncLastResult,
      }),
    onResult: (result) => {
      syncHasRun = true;
      syncLastResult = result;
      updateSyncHealth({
        remoteConfigured: true,
        hasRun: true,
        lastResult: result,
      });
    },
  });
}

function currentSessionService(): CoordinatedOperationsSessionService {
  if (sessionService === null)
    throw new Error('Operations session service has not been initialized.');
  return sessionService;
}

function currentOrdersService(): OperationsOrdersService {
  if (ordersService === null)
    throw new Error('Operations Orders service has not been initialized.');
  return ordersService;
}

function currentOrdersBoardService(): OperationsOrdersBoardService {
  if (ordersBoardService === null) {
    throw new Error('Operations Orders Board service has not been initialized.');
  }
  return ordersBoardService;
}

function registerIpcHandlers(window: BrowserWindow): void {
  for (const channel of [
    IPC_GET_APP_VERSION,
    IPC_SESSION_GET_STATE,
    IPC_SESSION_SUBMIT_PIN,
    IPC_SESSION_SIGN_OUT,
    IPC_SYNC_GET_STATUS,
    IPC_ORDERS_LOAD_WORKSPACE,
    IPC_ORDERS_SAVE_DRAFT,
    IPC_ORDERS_FIND_CUSTOMER,
    IPC_ORDERS_PLACE,
    IPC_ORDERS_REPRINT,
    IPC_BOARD_LOAD,
    IPC_BOARD_MARK_DONE,
    IPC_BOARD_UNDO_DONE,
    IPC_BOARD_CANCEL,
    IPC_BOARD_RETURN,
  ]) {
    ipcMain.removeHandler(channel);
  }

  ipcMain.handle(IPC_GET_APP_VERSION, (event) => {
    assertTrustedIpcSender(event, window.webContents.id);
    return app.getVersion();
  });
  ipcMain.handle(IPC_SYNC_GET_STATUS, (event) => {
    assertTrustedIpcSender(event, window.webContents.id);
    return syncHealthSnapshot;
  });
  ipcMain.handle(IPC_SESSION_GET_STATE, async (event) => {
    assertTrustedIpcSender(event, window.webContents.id);
    const result = await currentSessionService().getState();
    trackWorkerUiPreferencesIdentity(result);
    return result;
  });
  ipcMain.handle(IPC_SESSION_SUBMIT_PIN, async (event, pin: unknown) => {
    assertTrustedIpcSender(event, window.webContents.id);
    if (typeof pin !== 'string') throw new TypeError('PIN IPC payload must be a string.');
    const result = await currentSessionService().submitPin(pin);
    trackWorkerUiPreferencesIdentity(result);
    return result;
  });
  ipcMain.handle(IPC_SESSION_SIGN_OUT, async (event) => {
    assertTrustedIpcSender(event, window.webContents.id);
    const result = await currentSessionService().signOut();
    trackWorkerUiPreferencesIdentity(result);
    return result;
  });
  ipcMain.handle(IPC_ORDERS_LOAD_WORKSPACE, async (event, draftScopeId: unknown) => {
    assertTrustedIpcSender(event, window.webContents.id);
    if (typeof draftScopeId !== 'string') {
      throw new TypeError('Orders draft-scope IPC payload must be a string.');
    }
    return currentOrdersService().loadWorkspace(draftScopeId);
  });
  ipcMain.handle(IPC_ORDERS_SAVE_DRAFT, async (event, draft: unknown) => {
    assertTrustedIpcSender(event, window.webContents.id);
    return currentOrdersService().saveDraft(parseOrderDraft(draft));
  });
  ipcMain.handle(
    IPC_ORDERS_FIND_CUSTOMER,
    async (event, shopId: unknown, normalizedPhone: unknown) => {
      assertTrustedIpcSender(event, window.webContents.id);
      if (typeof shopId !== 'string' || typeof normalizedPhone !== 'string') {
        throw new TypeError('Customer lookup IPC payload is invalid.');
      }
      return currentOrdersService().findCustomerByPhone(
        parseEntityId<ShopId>(shopId),
        normalizedPhone,
      );
    },
  );
  ipcMain.handle(IPC_ORDERS_PLACE, async (event, draft: unknown) => {
    assertTrustedIpcSender(event, window.webContents.id);
    return currentOrdersService().placeOrder(parseOrderDraft(draft));
  });
  ipcMain.handle(IPC_ORDERS_REPRINT, async (event, orderId: unknown) => {
    assertTrustedIpcSender(event, window.webContents.id);
    if (typeof orderId !== 'string') {
      throw new TypeError('Order reprint IPC payload must be an Order ID string.');
    }
    return currentOrdersService().reprintOrder(parseEntityId<OrderId>(orderId));
  });
  ipcMain.handle(IPC_BOARD_LOAD, async (event) => {
    assertTrustedIpcSender(event, window.webContents.id);
    return currentOrdersBoardService().loadBoard();
  });
  ipcMain.handle(IPC_BOARD_MARK_DONE, async (event, orderId: unknown) => {
    assertTrustedIpcSender(event, window.webContents.id);
    if (typeof orderId !== 'string') throw new TypeError('Order ID must be a string.');
    return currentOrdersBoardService().markDone(parseEntityId<OrderId>(orderId));
  });
  ipcMain.handle(IPC_BOARD_UNDO_DONE, async (event, orderId: unknown) => {
    assertTrustedIpcSender(event, window.webContents.id);
    if (typeof orderId !== 'string') throw new TypeError('Order ID must be a string.');
    return currentOrdersBoardService().undoDone(parseEntityId<OrderId>(orderId));
  });
  ipcMain.handle(IPC_BOARD_CANCEL, async (event, input: unknown) => {
    assertTrustedIpcSender(event, window.webContents.id);
    assertObjectPayload(input, 'Cancel order');
    if (
      typeof input['orderId'] !== 'string' ||
      typeof input['foodPrepared'] !== 'boolean' ||
      typeof input['reason'] !== 'string'
    ) {
      throw new TypeError('Cancel order IPC payload is invalid.');
    }
    return currentOrdersBoardService().cancelOrder({
      orderId: parseEntityId<OrderId>(input['orderId']),
      foodPrepared: input['foodPrepared'],
      reason: input['reason'],
    });
  });
  ipcMain.handle(IPC_BOARD_RETURN, async (event, input: unknown) => {
    assertTrustedIpcSender(event, window.webContents.id);
    assertObjectPayload(input, 'Return Delivery');
    if (typeof input['orderId'] !== 'string' || typeof input['reason'] !== 'string') {
      throw new TypeError('Return Delivery IPC payload is invalid.');
    }
    return currentOrdersBoardService().returnDelivery({
      orderId: parseEntityId<OrderId>(input['orderId']),
      reason: input['reason'],
    });
  });

  if (expensesIpcRuntime === null) {
    throw new Error('Operations Expenses IPC runtime has not been initialized.');
  }
  if (bulkStockIpcRuntime === null) {
    throw new Error('Operations Bulk Stock IPC runtime has not been initialized.');
  }
  if (endDayIpcRuntime === null) {
    throw new Error('Operations End Day IPC runtime has not been initialized.');
  }
  expensesIpcRuntime.register(window);
  bulkStockIpcRuntime.register(window);
  endDayIpcRuntime.register(window);
}

async function createMainWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 640,
    show: false,
    backgroundColor: '#f4f1eb',
    webPreferences: createSecureWebPreferences(path.join(__dirname, '../preload/index.js')),
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.once('ready-to-show', () => window.show());
  registerIpcHandlers(window);

  const developmentUrl = process.env['TUX_OPERATIONS_DEV_URL'];
  if (developmentUrl === undefined || developmentUrl.trim() === '') {
    await window.loadFile(path.join(__dirname, '../../../operations/dist/index.html'));
  } else {
    await window.loadURL(parseLoopbackDevelopmentUrl(developmentUrl));
  }

  return window;
}

app.whenReady().then(async () => {
  await initializeOperationsServices();
  await createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
  });
});

app.on('before-quit', () => {
  if (configurationSyncTimer !== null) clearInterval(configurationSyncTimer);
  configurationSyncTimer = null;
  workerUiPreferencesRetry?.stop();
  workerUiPreferencesRetry = null;
  activeWorkerUiPreferencesIdentity = null;
  automaticSyncScheduler?.stop();
  void endDayIpcRuntime?.close();
  void bulkStockIpcRuntime?.close();
  void expensesIpcRuntime?.close();
  void operatorReadModel?.close();
  void orderDraftStore?.close();
  void operationsDatabase?.close();
  automaticSyncScheduler = null;
  endDayIpcRuntime = null;
  bulkStockIpcRuntime = null;
  expensesIpcRuntime = null;
  operatorReadModel = null;
  orderDraftStore = null;
  operationsDatabase = null;
  sessionService = null;
  ordersService = null;
  ordersBoardService = null;
  syncHasRun = false;
  syncLastResult = null;
  syncHealthSnapshot = buildSyncHealth({ remoteConfigured: false }) as TuxSyncHealthSnapshot;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
