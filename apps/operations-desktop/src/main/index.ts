import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';

const IPC_GET_APP_VERSION = 'tux:app:get-version';

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_GET_APP_VERSION, () => app.getVersion());
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

  window.once('ready-to-show', () => window.show());

  const developmentUrl = process.env['TUX_OPERATIONS_DEV_URL'];
  if (developmentUrl === undefined || developmentUrl.trim() === '') {
    await window.loadFile(path.join(__dirname, '../../../operations/dist/index.html'));
  } else {
    await window.loadURL(developmentUrl);
  }

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
