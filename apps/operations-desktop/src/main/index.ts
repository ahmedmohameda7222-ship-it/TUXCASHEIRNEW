import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import {
  ApplicationCommandCoordinator,
  CoordinatedOperationsSessionService,
  OperationsOrdersService,
} from '@tux/application';
import { instant, parseEntityId, type OrderDraft, type ShopId } from '@tux/domain';
import {
  SqliteOperationsDatabase,
  SqliteOperatorSessionReadModel,
  SqliteOrderDraftStore,
} from '@tux/persistence/sqlite';
import { app, BrowserWindow, ipcMain } from 'electron';
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
const IPC_ORDERS_LOAD_WORKSPACE = 'tux:orders:load-workspace';
const IPC_ORDERS_SAVE_DRAFT = 'tux:orders:save-draft';
const IPC_ORDERS_FIND_CUSTOMER = 'tux:orders:find-customer';
const IPC_ORDERS_PLACE = 'tux:orders:place';

let operationsDatabase: SqliteOperationsDatabase | null = null;
let operatorReadModel: SqliteOperatorSessionReadModel | null = null;
let orderDraftStore: SqliteOrderDraftStore | null = null;
let sessionService: CoordinatedOperationsSessionService | null = null;
let ordersService: OperationsOrdersService | null = null;

function assertObjectPayload(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} IPC payload must be an object.`);
  }
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
  sessionService = new CoordinatedOperationsSessionService(
    operationsDatabase,
    operatorReadModel,
    new NodePbkdf2PinVerifier(),
    runtime,
    coordinator,
  );
  ordersService = new OperationsOrdersService(
    operationsDatabase,
    operatorReadModel,
    orderDraftStore,
    runtime,
    coordinator,
  );
}

function currentSessionService(): CoordinatedOperationsSessionService {
  if (sessionService === null) {
    throw new Error('Operations session service has not been initialized.');
  }
  return sessionService;
}

function currentOrdersService(): OperationsOrdersService {
  if (ordersService === null) {
    throw new Error('Operations Orders service has not been initialized.');
  }
  return ordersService;
}

function registerIpcHandlers(window: BrowserWindow): void {
  for (const channel of [
    IPC_GET_APP_VERSION,
    IPC_SESSION_GET_STATE,
    IPC_SESSION_SUBMIT_PIN,
    IPC_SESSION_SIGN_OUT,
    IPC_ORDERS_LOAD_WORKSPACE,
    IPC_ORDERS_SAVE_DRAFT,
    IPC_ORDERS_FIND_CUSTOMER,
    IPC_ORDERS_PLACE,
  ]) {
    ipcMain.removeHandler(channel);
  }

  ipcMain.handle(IPC_GET_APP_VERSION, (event) => {
    assertTrustedIpcSender(event, window.webContents.id);
    return app.getVersion();
  });
  ipcMain.handle(IPC_SESSION_GET_STATE, async (event) => {
    assertTrustedIpcSender(event, window.webContents.id);
    return currentSessionService().getState();
  });
  ipcMain.handle(IPC_SESSION_SUBMIT_PIN, async (event, pin: unknown) => {
    assertTrustedIpcSender(event, window.webContents.id);
    if (typeof pin !== 'string') {
      throw new TypeError('PIN IPC payload must be a string.');
    }
    return currentSessionService().submitPin(pin);
  });
  ipcMain.handle(IPC_SESSION_SIGN_OUT, async (event) => {
    assertTrustedIpcSender(event, window.webContents.id);
    return currentSessionService().signOut();
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
    assertObjectPayload(draft, 'Order draft');
    return currentOrdersService().saveDraft(draft as unknown as OrderDraft);
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
    assertObjectPayload(draft, 'Order draft');
    return currentOrdersService().placeOrder(draft as unknown as OrderDraft);
  });
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
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on('before-quit', () => {
  void operatorReadModel?.close();
  void orderDraftStore?.close();
  void operationsDatabase?.close();
  operatorReadModel = null;
  orderDraftStore = null;
  operationsDatabase = null;
  sessionService = null;
  ordersService = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
