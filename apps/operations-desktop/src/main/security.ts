import type { IpcMainInvokeEvent, WebPreferences } from 'electron';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

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

  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error('TUX_OPERATIONS_DEV_URL must be an HTTP loopback URL.');
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
