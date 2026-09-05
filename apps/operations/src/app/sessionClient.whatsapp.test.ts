import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  storeConstructor: vi.fn(),
  storeInitialize: vi.fn().mockResolvedValue(undefined),
  remoteConstructor: vi.fn(),
  serviceConstructor: vi.fn(),
  resolveCustomerOrderContext: vi.fn().mockResolvedValue({
    ok: true,
    value: {
      kind: 'NO_ACTIVE_ORDER',
      customer: {
        normalizedPhone: '01012345678',
        displayPhone: '+201012345678',
        customerName: 'Customer',
        address: null,
        zoneId: null,
      },
      activeOrders: [],
    },
  }),
  loadInbox: vi.fn().mockResolvedValue({
    ok: true,
    value: {
      conversations: [],
      messages: [],
      quickReplies: [],
      orderLinks: [],
      nextCursor: null,
    },
  }),
}));

vi.mock('@tux/persistence/browser', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  class IndexedDbWhatsAppStore {
    constructor(name?: string) {
      mocks.storeConstructor(name);
    }
    initialize = mocks.storeInitialize;
  }
  return { ...actual, IndexedDbWhatsAppStore };
});

vi.mock('./browserWhatsAppRemote', () => ({
  VercelBrowserWhatsAppRemote: class {
    constructor() {
      mocks.remoteConstructor();
    }
  },
}));

vi.mock('@tux/application', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  class OperationsWhatsAppService {
    constructor(...args: unknown[]) {
      mocks.serviceConstructor(...args);
    }
    loadInbox = mocks.loadInbox;
    loadConversation = vi.fn();
    sendText = vi.fn();
    sendMedia = vi.fn();
    sendLocation = vi.fn();
    retryFailedMessage = vi.fn();
    getMediaAccess = vi.fn();
    markUnread = vi.fn();
    archive = vi.fn();
    setFollowUp = vi.fn();
    linkOrder = vi.fn();
    saveDraft = vi.fn();
    getDraft = vi.fn();
    resolveCustomerOrderContext = mocks.resolveCustomerOrderContext;
    resolveMessagingTarget = vi.fn();
    sendTemplate = vi.fn();
  }
  return { ...actual, OperationsWhatsAppService };
});

import { createOperationsWhatsAppClient } from './sessionClient';

const methodNames = [
  'archive',
  'getDraft',
  'getMediaAccess',
  'linkOrder',
  'loadConversation',
  'loadInbox',
  'markUnread',
  'resolveCustomerOrderContext',
  'resolveMessagingTarget',
  'retryFailedMessage',
  'saveDraft',
  'sendLocation',
  'sendMedia',
  'sendTemplate',
  'sendText',
  'setFollowUp',
];

describe('createOperationsWhatsAppClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: { tuxDesktop: undefined },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window');
  });

  it('returns the desktop WhatsApp API when the Electron bridge is available', () => {
    const desktopWhatsApp = Object.fromEntries(methodNames.map((name) => [name, vi.fn()]));
    window.tuxDesktop = { whatsapp: desktopWhatsApp } as never;

    expect(createOperationsWhatsAppClient()).toBe(desktopWhatsApp);
    expect(mocks.storeConstructor).not.toHaveBeenCalled();
    expect(mocks.remoteConstructor).not.toHaveBeenCalled();
  });

  it('lazily composes IndexedDB v5 database name, Vercel remote, and application service in browser mode', async () => {
    const client = createOperationsWhatsAppClient();

    expect(Object.keys(client).sort()).toEqual(methodNames);
    expect('sendMedia' in client).toBe(true);
    expect(mocks.storeConstructor).not.toHaveBeenCalled();

    await client.loadInbox();

    expect(mocks.storeConstructor).toHaveBeenCalledTimes(1);
    expect(mocks.storeConstructor).toHaveBeenCalledWith('tux-operations-v2');
    expect(mocks.storeInitialize).toHaveBeenCalledTimes(1);
    expect(mocks.remoteConstructor).toHaveBeenCalledTimes(1);
    expect(mocks.serviceConstructor).toHaveBeenCalledTimes(1);
    expect(mocks.loadInbox).toHaveBeenCalledTimes(1);

    const context = await client.resolveCustomerOrderContext(
      '22222222-2222-4222-8222-222222222222',
    );
    expect(context).toMatchObject({ ok: true, value: { kind: 'NO_ACTIVE_ORDER' } });
    expect(mocks.resolveCustomerOrderContext).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
    );
  });
});
