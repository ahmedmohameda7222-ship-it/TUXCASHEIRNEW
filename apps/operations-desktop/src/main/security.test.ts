import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { installOperationsPermissionHandlers } from './security';

const TRUSTED_URL = 'http://127.0.0.1:5173/';
const mainSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

type TestWebContents = {
  readonly id: number;
  readonly getURL: () => string;
};

type PermissionRequestDetails = {
  readonly isMainFrame: boolean;
  readonly requestingUrl?: string;
  readonly mediaTypes?: readonly string[];
};

type PermissionCheckDetails = {
  readonly isMainFrame: boolean;
  readonly requestingUrl?: string;
  readonly mediaType?: string;
};

type RequestHandler = (
  webContents: TestWebContents,
  permission: string,
  callback: (granted: boolean) => void,
  details: PermissionRequestDetails,
) => void;

type CheckHandler = (
  webContents: TestWebContents | null,
  permission: string,
  requestingOrigin: string,
  details: PermissionCheckDetails,
) => boolean;

class PermissionSessionFixture {
  requestHandler: RequestHandler | null = null;
  checkHandler: CheckHandler | null = null;

  setPermissionRequestHandler(handler: RequestHandler | null): void {
    this.requestHandler = handler;
  }

  setPermissionCheckHandler(handler: CheckHandler | null): void {
    this.checkHandler = handler;
  }
}

function webContents(id = 7, url = TRUSTED_URL): TestWebContents {
  return { id, getURL: () => url };
}

function requestDecision(
  session: PermissionSessionFixture,
  input: {
    readonly webContents?: TestWebContents;
    readonly permission: string;
    readonly details: PermissionRequestDetails;
  },
): boolean {
  const handler = session.requestHandler;
  if (handler === null) throw new Error('Permission request handler was not installed.');
  let decision: boolean | null = null;
  handler(input.webContents ?? webContents(), input.permission, (granted) => (decision = granted), input.details);
  if (decision === null) throw new Error('Permission request callback was not resolved.');
  return decision;
}

describe('Electron security foundation', () => {
  it('keeps privileged renderer capabilities disabled', async () => {
    const { createSecureWebPreferences } = await import('./security');
    expect(createSecureWebPreferences('/tmp/preload.js')).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    });
  });

  it('accepts only loopback HTTP development URLs', async () => {
    const { parseLoopbackDevelopmentUrl } = await import('./security');
    expect(parseLoopbackDevelopmentUrl('http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173/');
    expect(parseLoopbackDevelopmentUrl('http://localhost:5173')).toBe('http://localhost:5173/');
    expect(() => parseLoopbackDevelopmentUrl('https://example.com')).toThrow();
    expect(() => parseLoopbackDevelopmentUrl('http://example.com')).toThrow();
  });
});

describe('Task 9D Electron microphone/geolocation permission fence', () => {
  it('installs both permission request and permission check handlers in the main window runtime', () => {
    expect(mainSource).toContain('installOperationsPermissionHandlers');
    expect(mainSource).toContain('window.webContents.session');
  });

  it('allows only trusted top-level audio capture and geolocation requests', () => {
    const session = new PermissionSessionFixture();
    installOperationsPermissionHandlers(session, 7, TRUSTED_URL);

    expect(
      requestDecision(session, {
        permission: 'media',
        details: { isMainFrame: true, requestingUrl: TRUSTED_URL, mediaTypes: ['audio'] },
      }),
    ).toBe(true);
    expect(
      requestDecision(session, {
        permission: 'geolocation',
        details: { isMainFrame: true, requestingUrl: TRUSTED_URL },
      }),
    ).toBe(true);

    expect(
      requestDecision(session, {
        permission: 'media',
        details: { isMainFrame: true, requestingUrl: TRUSTED_URL, mediaTypes: ['video'] },
      }),
    ).toBe(false);
    expect(
      requestDecision(session, {
        permission: 'media',
        details: {
          isMainFrame: true,
          requestingUrl: TRUSTED_URL,
          mediaTypes: ['audio', 'video'],
        },
      }),
    ).toBe(false);
    expect(
      requestDecision(session, {
        permission: 'notifications',
        details: { isMainFrame: true, requestingUrl: TRUSTED_URL },
      }),
    ).toBe(false);
    expect(
      requestDecision(session, {
        permission: 'media',
        details: { isMainFrame: false, requestingUrl: TRUSTED_URL, mediaTypes: ['audio'] },
      }),
    ).toBe(false);
    expect(
      requestDecision(session, {
        webContents: webContents(99),
        permission: 'geolocation',
        details: { isMainFrame: true, requestingUrl: TRUSTED_URL },
      }),
    ).toBe(false);
    expect(
      requestDecision(session, {
        webContents: webContents(7, 'https://evil.example/'),
        permission: 'geolocation',
        details: { isMainFrame: true, requestingUrl: 'https://evil.example/' },
      }),
    ).toBe(false);
  });

  it('applies the same deny-by-default fence to permission checks', () => {
    const session = new PermissionSessionFixture();
    installOperationsPermissionHandlers(session, 7, TRUSTED_URL);
    const check = session.checkHandler;
    if (check === null) throw new Error('Permission check handler was not installed.');

    expect(
      check(webContents(), 'media', TRUSTED_URL, {
        isMainFrame: true,
        requestingUrl: TRUSTED_URL,
        mediaType: 'audio',
      }),
    ).toBe(true);
    expect(
      check(webContents(), 'geolocation', TRUSTED_URL, {
        isMainFrame: true,
        requestingUrl: TRUSTED_URL,
      }),
    ).toBe(true);

    expect(
      check(webContents(), 'media', TRUSTED_URL, {
        isMainFrame: true,
        requestingUrl: TRUSTED_URL,
        mediaType: 'video',
      }),
    ).toBe(false);
    expect(
      check(webContents(), 'notifications', TRUSTED_URL, {
        isMainFrame: true,
        requestingUrl: TRUSTED_URL,
      }),
    ).toBe(false);
    expect(
      check(webContents(), 'geolocation', 'https://evil.example/', {
        isMainFrame: true,
        requestingUrl: 'https://evil.example/',
      }),
    ).toBe(false);
    expect(
      check(webContents(), 'geolocation', TRUSTED_URL, {
        isMainFrame: false,
        requestingUrl: TRUSTED_URL,
      }),
    ).toBe(false);
    expect(
      check(null, 'geolocation', TRUSTED_URL, {
        isMainFrame: false,
        requestingUrl: TRUSTED_URL,
      }),
    ).toBe(false);
  });
});
