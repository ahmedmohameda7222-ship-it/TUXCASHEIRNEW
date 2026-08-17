import type { TuxDesktopApi } from '@tux/platform-contracts';
import { contextBridge, ipcRenderer } from 'electron';
import { assertSessionResult } from './sessionResult';

const IPC_GET_APP_VERSION = 'tux:app:get-version';
const IPC_SESSION_GET_STATE = 'tux:session:get-state';
const IPC_SESSION_SUBMIT_PIN = 'tux:session:submit-pin';
const IPC_SESSION_SIGN_OUT = 'tux:session:sign-out';

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
  session: Object.freeze({
    getState: async () =>
      assertSessionResult((await ipcRenderer.invoke(IPC_SESSION_GET_STATE)) as unknown),
    submitPin: async (pin: string) =>
      assertSessionResult((await ipcRenderer.invoke(IPC_SESSION_SUBMIT_PIN, pin)) as unknown),
    signOut: async () =>
      assertSessionResult((await ipcRenderer.invoke(IPC_SESSION_SIGN_OUT)) as unknown),
  }),
});

contextBridge.exposeInMainWorld('tuxDesktop', api);
