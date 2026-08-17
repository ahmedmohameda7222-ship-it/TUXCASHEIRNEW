import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'node:path';

const IPC_GET_APP_VERSION = 'tux:app:get-version';
const OPERATIONS_DEV_PORT = '5173';
const OPERATIONS_DEV_HOSTS = new Set(['127.0.0.1', 'localhost']);

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_GET_APP_VERSION, () => app.getVersion());
}

function parseDevelopmentUrl(rawUrl: string | undefined): URL | null {
  if (rawUrl === undefined || rawUrl.trim() === '') {
    return null;
  }

  const url = new URL(rawUrl);
  const isApprovedLocalDevelopmentUrl =
    url.protocol === 'http:' &&
    OPERATIONS_DEV_HOSTS.has(url.hostname) &&
    url.port === OPERATIONS_DEV_PORT;

  if (!isApprovedLocalDevelopmentUrl) {
    throw new Error(
      'TUX_OPERATIONS_DEV_URL must use http://localhost:5173 or http://127.0.0.1:5173.',
    );
  }

  return url;
}

async function createMainWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 640,
    show: false,
    backgroundColor: '#f4f1eb',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.once('ready-to-show', () => window.show());

  const developmentUrl = parseDevelopmentUrl(process.env['TUX_OPERATIONS_DEV_URL']);
  if (developmentUrl === null) {
    await window.loadFile(path.join(__dirname, '../../../operations/dist/index.html'));
  } else {
    await window.loadURL(developmentUrl.toString());
  }

  window.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  return window;
}

app.whenReady().then(async () => {
  registerIpcHandlers();
  await createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
