import type { IpcMainInvokeEvent, WebPreferences } from 'electron';

const OPERATIONS_DEV_PORT = '5173';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

type PermissionWebContents = {
  readonly id: number;
  readonly getURL: () => string;
};

type PermissionRequestDetails = {
  readonly isMainFrame?: boolean;
  readonly requestingUrl?: string;
  readonly mediaTypes?: readonly string[];
};

type PermissionCheckDetails = {
  readonly isMainFrame?: boolean;
  readonly requestingUrl?: string;
  readonly mediaType?: string;
};

type PermissionRequestHandler = (
  webContents: PermissionWebContents,
  permission: string,
  callback: (granted: boolean) => void,
  details: PermissionRequestDetails,
) => void;

type PermissionCheckHandler = (
  webContents: PermissionWebContents | null,
  permission: string,
  requestingOrigin: string,
  details: PermissionCheckDetails,
) => boolean;

type PermissionSession = {
  readonly setPermissionRequestHandler: (handler: PermissionRequestHandler | null) => void;
  readonly setPermissionCheckHandler: (handler: PermissionCheckHandler | null) => void;
};

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

function isTrustedRendererUrl(candidate: string | undefined, trustedUrl: URL): boolean {
  if (candidate === undefined || candidate.trim() === '') return false;
  try {
    const url = new URL(candidate);
    if (trustedUrl.protocol === 'file:') {
      return (
        url.protocol === 'file:' &&
        url.hostname === trustedUrl.hostname &&
        url.pathname === trustedUrl.pathname
      );
    }
    return url.protocol === trustedUrl.protocol && url.origin === trustedUrl.origin;
  } catch {
    return false;
  }
}

function isTrustedTopLevelRequest(
  webContents: PermissionWebContents | null,
  details: PermissionRequestDetails | PermissionCheckDetails,
  trustedWebContentsId: number,
  trustedUrl: URL,
): boolean {
  return (
    webContents !== null &&
    webContents.id === trustedWebContentsId &&
    details.isMainFrame === true &&
    isTrustedRendererUrl(webContents.getURL(), trustedUrl) &&
    isTrustedRendererUrl(details.requestingUrl, trustedUrl)
  );
}

function isAllowedPermissionRequest(
  permission: string,
  details: PermissionRequestDetails,
): boolean {
  if (permission === 'geolocation') return true;
  return (
    permission === 'media' &&
    details.mediaTypes?.length === 1 &&
    details.mediaTypes[0] === 'audio'
  );
}

function isAllowedPermissionCheck(permission: string, details: PermissionCheckDetails): boolean {
  if (permission === 'geolocation') return true;
  return permission === 'media' && details.mediaType === 'audio';
}

export function installOperationsPermissionHandlers(
  session: unknown,
  trustedWebContentsId: number,
  trustedRendererUrl: string,
): void {
  const trustedUrl = new URL(trustedRendererUrl);
  const permissionSession = session as PermissionSession;
  if (
    typeof permissionSession.setPermissionRequestHandler !== 'function' ||
    typeof permissionSession.setPermissionCheckHandler !== 'function'
  ) {
    throw new TypeError('Electron permission session is unavailable.');
  }

  permissionSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(
      isTrustedTopLevelRequest(webContents, details, trustedWebContentsId, trustedUrl) &&
        isAllowedPermissionRequest(permission, details),
    );
  });

  permissionSession.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) =>
      isTrustedRendererUrl(requestingOrigin, trustedUrl) &&
      isTrustedTopLevelRequest(webContents, details, trustedWebContentsId, trustedUrl) &&
      isAllowedPermissionCheck(permission, details),
  );
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
