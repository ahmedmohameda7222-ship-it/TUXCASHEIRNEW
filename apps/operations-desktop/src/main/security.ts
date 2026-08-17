import type { IpcMainInvokeEvent, WebPreferences } from 'electron';

const OPERATIONS_DEV_PORT = '5173';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

export function createSecureWebPreferences(preloadPath: string): WebPreferences {
  return {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    webviewTag: false,
    spellcheck: false,
  };
}

export function parseLoopbackDevelopmentUrl(value: string): string {
  const url = new URL(value);
  const isApprovedLocalDevelopmentUrl =
    url.protocol === 'http:' &&
    LOOPBACK_HOSTS.has(url.hostname) &&
    url.port === OPERATIONS_DEV_PORT;

  if (!isApprovedLocalDevelopmentUrl) {
    throw new Error(
      'TUX_OPERATIONS_DEV_URL must use http://localhost:5173 or http://127.0.0.1:5173.',
    );
  }

  return url.toString();
}

export function assertTrustedIpcSender(
  event: IpcMainInvokeEvent,
  trustedWebContentsId: number,
): void {
  if (
    event.sender.id !== trustedWebContentsId ||
    event.senderFrame === null ||
    event.senderFrame !== event.sender.mainFrame
  ) {
    throw new Error('Rejected IPC call from an untrusted renderer frame.');
  }
}
