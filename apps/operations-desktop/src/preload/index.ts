import { contextBridge, ipcRenderer } from 'electron';
import type { TuxDesktopApi } from '@tux/platform-contracts';

const IPC_GET_APP_VERSION = 'tux:app:get-version';

const api: TuxDesktopApi = Object.freeze({
  app: Object.freeze({
    getVersion: async () => {
      const version: unknown = await ipcRenderer.invoke(IPC_GET_APP_VERSION);
      if (typeof version !== 'string') {
        throw new TypeError('Invalid app version response from Electron main process.');
      }
      return version;
    },
  }),
});

contextBridge.exposeInMainWorld('tuxDesktop', api);
