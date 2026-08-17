import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'node:path';
import {
  assertTrustedIpcSender,
  createSecureWebPreferences,
  parseLoopbackDevelopmentUrl,
} from './security';

const IPC_GET_APP_VERSION = 'tux:app:get-version';

function registerIpcHandlers(window: BrowserWindow): void {
  ipcMain.removeHandler(IPC_GET_APP_VERSION);
  ipcMain.handle(IPC_GET_APP_VERSION, (event) => {
    assertTrustedIpcSender(event, window.webContents.id);
    return app.getVersion();
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
