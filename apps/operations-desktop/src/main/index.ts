import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { OperationsSessionService } from '@tux/application';
import { instant } from '@tux/domain';
import { SqliteOperationsDatabase, SqliteOperatorSessionReadModel } from '@tux/persistence/sqlite';
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

let operationsDatabase: SqliteOperationsDatabase | null = null;
let operatorReadModel: SqliteOperatorSessionReadModel | null = null;
let sessionService: OperationsSessionService | null = null;

async function initializeOperationsServices(): Promise<void> {
  const databasePath = path.join(app.getPath('userData'), 'tux-operations-v2.sqlite3');
  operationsDatabase = new SqliteOperationsDatabase(databasePath);
  await operationsDatabase.initialize();
  operatorReadModel = new SqliteOperatorSessionReadModel(databasePath);
  sessionService = new OperationsSessionService(
    operationsDatabase,
    operatorReadModel,
    new NodePbkdf2PinVerifier(),
    {
      now: () => instant(new Date()),
      createUuid: () => randomUUID(),
    },
  );
}

function currentSessionService(): OperationsSessionService {
  if (sessionService === null) {
    throw new Error('Operations session service has not been initialized.');
  }
  return sessionService;
}

function registerIpcHandlers(window: BrowserWindow): void {
  for (const channel of [
    IPC_GET_APP_VERSION,
    IPC_SESSION_GET_STATE,
    IPC_SESSION_SUBMIT_PIN,
    IPC_SESSION_SIGN_OUT,
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
  void operationsDatabase?.close();
  operatorReadModel = null;
  operationsDatabase = null;
  sessionService = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
