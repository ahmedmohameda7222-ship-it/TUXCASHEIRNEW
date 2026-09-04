import type { ApplicationError, WhatsAppInboxSnapshot } from '@tux/application';
import type { WhatsAppConversation, WhatsAppMessage } from '@tux/domain';
import type { TuxWhatsAppApi } from '@tux/platform-contracts';
import type { WhatsAppDraft } from '@tux/persistence';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBrowserWhatsAppInboxEnvironment,
  WhatsAppInboxController,
  type WhatsAppInboxControllerEnvironment,
} from './whatsappInboxController';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';

function conversation(
  id: string,
  overrides: Partial<WhatsAppConversation> = {},
): WhatsAppConversation {
  return {
    id,
    shopId: SHOP_ID,
    normalizedPhone: `+2010${id.length}000000`,
    displayPhone: `010 ${id.length}00 0000`,
    customerName: id,
    context: 'DIRECT',
    linkedOrderId: null,
    unreadCount: 0,
    archived: false,
    followUp: false,
    lastMessageAt: `2026-09-03T12:00:0${id.length}.000Z`,
    ...overrides,
  } as WhatsAppConversation;
}

function message(
  id: string,
  conversationId: string,
  overrides: Partial<WhatsAppMessage> = {},
): WhatsAppMessage {
  return {
    id,
    shopId: SHOP_ID,
    conversationId,
    providerMessageId: null,
    outboundIntentKey: null,
    direction: 'INBOUND',
    kind: 'TEXT',
    text: id,
    mediaRef: null,
    status: 'DELIVERED',
    sentByWorkerId: null,
    initiatedByDeviceId: null,
    initiatedAt: null,
    createdAt: '2026-09-03T12:00:00.000Z',
    ...overrides,
  } as WhatsAppMessage;
}

function draft(conversationId: string, text: string): WhatsAppDraft {
  return {
    shopId: SHOP_ID,
    conversationId,
    text,
    updatedAt: '2026-09-03T12:00:00.000Z',
  } as WhatsAppDraft;
}

function snapshot(
  conversations: readonly WhatsAppConversation[] = [],
  messages: readonly WhatsAppMessage[] = [],
): WhatsAppInboxSnapshot {
  return {
    conversations,
    messages,
    quickReplies: [],
    orderLinks: [],
    nextCursor: null,
  };
}

function ok<T>(value: T) {
  return { ok: true, value } as const;
}

function failure(messageText: string, code: ApplicationError['code'] = 'REMOTE_SYNC_ERROR') {
  return {
    ok: false,
    error: {
      code,
      message: messageText,
      cause: new Error('SECRET_CAUSE_MUST_NOT_LEAK'),
    },
  } as const;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 12; index += 1) {
    await Promise.resolve();
  }
}

class TestEnvironment implements WhatsAppInboxControllerEnvironment {
  now = 1_000;
  online = true;
  hidden = false;
  intentCounter = 0;
  intervalCounter = 0;
  timeoutCounter = 0;

  readonly intervals = new Map<number, { callback: () => void; intervalMs: number }>();
  readonly timeouts = new Map<number, { callback: () => void; delayMs: number }>();
  readonly visibilityListeners = new Set<() => void>();
  readonly onlineListeners = new Set<() => void>();
  readonly offlineListeners = new Set<() => void>();

  readonly nowMs = () => this.now;
  readonly createIntentKey = vi.fn(() => `intent-${++this.intentCounter}`);

  readonly setInterval = (callback: () => void, intervalMs: number): unknown => {
    const handle = ++this.intervalCounter;
    this.intervals.set(handle, { callback, intervalMs });
    return handle;
  };

  readonly clearInterval = (handle: unknown): void => {
    this.intervals.delete(handle as number);
  };

  readonly setTimeout = (callback: () => void, delayMs: number): unknown => {
    const handle = ++this.timeoutCounter;
    this.timeouts.set(handle, { callback, delayMs });
    return handle;
  };

  readonly clearTimeout = (handle: unknown): void => {
    this.timeouts.delete(handle as number);
  };

  readonly isDocumentHidden = () => this.hidden;
  readonly isOnline = () => this.online;

  readonly addVisibilityListener = (listener: () => void): (() => void) => {
    this.visibilityListeners.add(listener);
    return () => this.visibilityListeners.delete(listener);
  };

  readonly addOnlineListener = (listener: () => void): (() => void) => {
    this.onlineListeners.add(listener);
    return () => this.onlineListeners.delete(listener);
  };

  readonly addOfflineListener = (listener: () => void): (() => void) => {
    this.offlineListeners.add(listener);
    return () => this.offlineListeners.delete(listener);
  };

  fireInterval(intervalMs = 15_000): void {
    for (const item of [...this.intervals.values()]) {
      if (item.intervalMs === intervalMs) item.callback();
    }
  }

  fireTimeout(delayMs = 250): void {
    for (const [handle, item] of [...this.timeouts.entries()]) {
      if (item.delayMs !== delayMs) continue;
      this.timeouts.delete(handle);
      item.callback();
    }
  }

  fireVisibility(): void {
    for (const listener of [...this.visibilityListeners]) listener();
  }

  fireOnline(): void {
    this.online = true;
    for (const listener of [...this.onlineListeners]) listener();
  }

  fireOffline(): void {
    this.online = false;
    for (const listener of [...this.offlineListeners]) listener();
  }

  listenerCount(): number {
    return this.visibilityListeners.size + this.onlineListeners.size + this.offlineListeners.size;
  }
}

function createClient(initialSnapshot: WhatsAppInboxSnapshot = snapshot()) {
  const loadInbox = vi.fn<TuxWhatsAppApi['loadInbox']>().mockResolvedValue(ok(initialSnapshot));
  const loadConversation = vi.fn<TuxWhatsAppApi['loadConversation']>().mockResolvedValue(ok([]));
  const sendText = vi
    .fn<TuxWhatsAppApi['sendText']>()
    .mockResolvedValue(
      ok(message('sent', 'default', { direction: 'OUTBOUND', outboundIntentKey: 'sent-key' })),
    );
  const markUnread = vi.fn<TuxWhatsAppApi['markUnread']>().mockResolvedValue(ok(undefined));
  const archive = vi.fn<TuxWhatsAppApi['archive']>().mockResolvedValue(ok(undefined));
  const setFollowUp = vi.fn<TuxWhatsAppApi['setFollowUp']>().mockResolvedValue(ok(undefined));
  const linkOrder = vi.fn<TuxWhatsAppApi['linkOrder']>().mockResolvedValue(ok(undefined));
  const saveDraft = vi.fn<TuxWhatsAppApi['saveDraft']>().mockResolvedValue(ok(undefined));
  const getDraft = vi.fn<TuxWhatsAppApi['getDraft']>().mockResolvedValue(ok(null));
  const resolveCustomerOrderContext = vi
    .fn<TuxWhatsAppApi['resolveCustomerOrderContext']>()
    .mockResolvedValue(
      ok({
        kind: 'NO_ACTIVE_ORDER',
        customer: {
          normalizedPhone: '01012345678',
          displayPhone: '+201012345678',
          customerName: 'Customer',
          address: null,
          zoneId: null,
        },
        activeOrders: [],
      }),
    );

  const api: TuxWhatsAppApi = {
    loadInbox,
    loadConversation,
    sendText,
    markUnread,
    archive,
    setFollowUp,
    linkOrder,
    saveDraft,
    getDraft,
    resolveCustomerOrderContext,
  };

  return {
    api,
    loadInbox,
    loadConversation,
    sendText,
    markUnread,
    archive,
    setFollowUp,
    saveDraft,
    getDraft,
    resolveCustomerOrderContext,
  };
}

async function loadController(inbox: WhatsAppInboxSnapshot, environment = new TestEnvironment()) {
  const client = createClient(inbox);
  const controller = new WhatsAppInboxController(client.api, environment);
  await controller.refresh();
  return { client, controller, environment };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WhatsAppInboxController refresh lifecycle', () => {
  it('performs exactly one initial online load and installs a 15-second poller', async () => {
    const env = new TestEnvironment();
    const client = createClient(snapshot([conversation('a')]));
    const controller = new WhatsAppInboxController(client.api, env);

    controller.start();
    expect(client.loadInbox).toHaveBeenCalledTimes(1);
    expect([...env.intervals.values()].map((item) => item.intervalMs)).toEqual([15_000]);

    await settle();
    expect(controller.getState().snapshot?.conversations.map((item) => item.id)).toEqual(['a']);
  });

  it('performs one initial offline cache-capable load while preserving the offline advisory', async () => {
    const env = new TestEnvironment();
    env.online = false;
    const client = createClient(snapshot([conversation('cached')]));
    const controller = new WhatsAppInboxController(client.api, env);

    controller.start();
    expect(client.loadInbox).toHaveBeenCalledTimes(1);

    await settle();
    expect(controller.getState().snapshot?.conversations.map((item) => item.id)).toEqual([
      'cached',
    ]);
    expect(controller.getState().networkOffline).toBe(true);
  });

  it('polls every 15 seconds only while visible and online', async () => {
    const env = new TestEnvironment();
    const client = createClient(snapshot());
    const controller = new WhatsAppInboxController(client.api, env);

    controller.start();
    await settle();
    expect(client.loadInbox).toHaveBeenCalledTimes(1);

    env.fireInterval();
    await settle();
    expect(client.loadInbox).toHaveBeenCalledTimes(2);
  });

  it('pauses periodic polling while offline', async () => {
    const env = new TestEnvironment();
    env.online = false;
    const client = createClient(snapshot());
    const controller = new WhatsAppInboxController(client.api, env);

    controller.start();
    await settle();
    expect(client.loadInbox).toHaveBeenCalledTimes(1);

    env.fireInterval();
    await settle();
    expect(client.loadInbox).toHaveBeenCalledTimes(1);
  });

  it('pauses periodic polling while the document is hidden', async () => {
    const env = new TestEnvironment();
    env.hidden = true;
    const client = createClient(snapshot());
    const controller = new WhatsAppInboxController(client.api, env);

    controller.start();
    await settle();
    expect(client.loadInbox).toHaveBeenCalledTimes(1);

    env.fireInterval();
    await settle();
    expect(client.loadInbox).toHaveBeenCalledTimes(1);
  });

  it('runs one refresh at a time and coalesces concurrent triggers to at most one pending refresh', async () => {
    const env = new TestEnvironment();
    const client = createClient(snapshot());
    const first = deferred<Awaited<ReturnType<TuxWhatsAppApi['loadInbox']>>>();
    client.loadInbox
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(ok(snapshot([conversation('after')])));

    const controller = new WhatsAppInboxController(client.api, env);
    const firstRefresh = controller.refresh();
    const secondRefresh = controller.refresh();
    const thirdRefresh = controller.refresh();

    expect(client.loadInbox).toHaveBeenCalledTimes(1);

    first.resolve(ok(snapshot([conversation('before')])));
    await Promise.all([firstRefresh, secondRefresh, thirdRefresh]);

    expect(client.loadInbox).toHaveBeenCalledTimes(2);
    expect(controller.getState().snapshot?.conversations.map((item) => item.id)).toEqual(['after']);
  });

  it('preserves the last successful snapshot and unread total when refresh fails', async () => {
    const goodSnapshot = snapshot([
      conversation('visible', { unreadCount: 7 }),
      conversation('archived', { archived: true, unreadCount: 99 }),
    ]);
    const { client, controller } = await loadController(goodSnapshot);
    const previousSnapshot = controller.getState().snapshot;

    client.loadInbox.mockResolvedValueOnce(failure('Safe refresh failure'));
    await controller.refresh();

    expect(controller.getState().snapshot).toBe(previousSnapshot);
    expect(controller.getState().totalUnread).toBe(7);
    expect(controller.getState().errorMessage).toBe('Safe refresh failure');
    expect(controller.getState().errorMessage).not.toContain('SECRET_CAUSE');
  });

  it('does not infer provider/network availability from a successful load result', async () => {
    const env = new TestEnvironment();
    env.online = false;
    const client = createClient(snapshot([conversation('cached')]));
    const controller = new WhatsAppInboxController(client.api, env);

    await controller.refresh();

    expect(controller.getState().snapshot).not.toBeNull();
    expect(controller.getState().networkOffline).toBe(true);
  });

  it('refreshes exactly once on an online transition and never sends or replays a message', async () => {
    const env = new TestEnvironment();
    env.online = false;
    const client = createClient(snapshot());
    const controller = new WhatsAppInboxController(client.api, env);

    controller.start();
    await settle();
    expect(client.loadInbox).toHaveBeenCalledTimes(1);

    env.fireOnline();
    await settle();

    expect(client.loadInbox).toHaveBeenCalledTimes(2);
    expect(client.sendText).not.toHaveBeenCalled();
    expect(controller.getState().networkOffline).toBe(false);
  });

  it('refreshes once when visibility is restored while online', async () => {
    const env = new TestEnvironment();
    const client = createClient(snapshot());
    const controller = new WhatsAppInboxController(client.api, env);

    controller.start();
    await settle();

    env.hidden = true;
    env.fireVisibility();
    await settle();
    expect(client.loadInbox).toHaveBeenCalledTimes(1);

    env.hidden = false;
    env.fireVisibility();
    await settle();
    expect(client.loadInbox).toHaveBeenCalledTimes(2);
  });

  it('onAreaSelected refreshes online, and offline only before any successful snapshot exists', async () => {
    const onlineEnv = new TestEnvironment();
    const onlineClient = createClient(snapshot());
    const onlineController = new WhatsAppInboxController(onlineClient.api, onlineEnv);
    onlineController.onAreaSelected();
    await settle();
    expect(onlineClient.loadInbox).toHaveBeenCalledTimes(1);

    const offlineEnv = new TestEnvironment();
    offlineEnv.online = false;
    const offlineClient = createClient(snapshot([conversation('cached')]));
    const offlineController = new WhatsAppInboxController(offlineClient.api, offlineEnv);
    offlineController.onAreaSelected();
    await settle();
    expect(offlineClient.loadInbox).toHaveBeenCalledTimes(1);

    offlineController.onAreaSelected();
    await settle();
    expect(offlineClient.loadInbox).toHaveBeenCalledTimes(1);
  });
});

describe('WhatsAppInboxController selection fencing', () => {
  it('keeps the current selection when it remains visible after refresh', async () => {
    const a = conversation('a', { lastMessageAt: '2026-09-03T12:00:02.000Z' as never });
    const b = conversation('b', { lastMessageAt: '2026-09-03T12:00:01.000Z' as never });
    const { client, controller } = await loadController(snapshot([a, b]));

    await controller.selectConversation('b');
    expect(controller.getState().selectedConversationId).toBe('b');

    client.loadConversation.mockClear();
    client.getDraft.mockClear();
    client.loadInbox.mockResolvedValueOnce(ok(snapshot([a, b])));
    await controller.refresh();

    expect(controller.getState().selectedConversationId).toBe('b');
    expect(client.loadConversation).not.toHaveBeenCalled();
    expect(client.getDraft).not.toHaveBeenCalled();
  });

  it('selects the first visible conversation through the common selection-loading path when the old one disappears', async () => {
    const a = conversation('a', { lastMessageAt: '2026-09-03T12:00:02.000Z' as never });
    const b = conversation('b', { lastMessageAt: '2026-09-03T12:00:01.000Z' as never });
    const { client, controller } = await loadController(snapshot([a, b]));
    await controller.selectConversation('b');

    client.loadConversation.mockClear();
    client.getDraft.mockClear();
    client.loadInbox.mockResolvedValueOnce(ok(snapshot([a])));
    await controller.refresh();

    expect(controller.getState().selectedConversationId).toBe('a');
    expect(client.loadConversation).toHaveBeenCalledExactlyOnceWith('a');
    expect(client.getDraft).toHaveBeenCalledExactlyOnceWith('a');
  });

  it('clears selected messages, composer, and selection when no conversation remains visible', async () => {
    const a = conversation('a');
    const { client, controller } = await loadController(snapshot([a]));
    client.loadConversation.mockResolvedValueOnce(ok([message('a-message', 'a')]));
    client.getDraft.mockResolvedValueOnce(ok(draft('a', 'saved draft')));
    await controller.selectConversation('a');
    expect(controller.getState().composerText).toBe('saved draft');

    client.loadInbox.mockResolvedValueOnce(ok(snapshot([conversation('a', { archived: true })])));
    await controller.refresh();

    expect(controller.getState().selectedConversationId).toBeNull();
    expect(controller.getState().selectedMessages).toEqual([]);
    expect(controller.getState().composerText).toBe('');
  });

  it('loads local messages and draft together when selecting a conversation', async () => {
    const a = conversation('a');
    const b = conversation('b');
    const { client, controller } = await loadController(snapshot([a, b]));
    const bMessages = [message('b-message', 'b')];
    client.loadConversation.mockResolvedValueOnce(ok(bMessages));
    client.getDraft.mockResolvedValueOnce(ok(draft('b', 'draft b')));

    await controller.selectConversation('b');

    expect(client.loadConversation).toHaveBeenCalledWith('b');
    expect(client.getDraft).toHaveBeenCalledWith('b');
    expect(controller.getState().selectedMessages).toEqual(bMessages);
    expect(controller.getState().composerText).toBe('draft b');
  });

  it('ignores stale Conversation A messages, draft, and error after Conversation B becomes current', async () => {
    const a = conversation('a');
    const b = conversation('b');
    const { client, controller } = await loadController(snapshot([a, b]));
    const aMessages = deferred<Awaited<ReturnType<TuxWhatsAppApi['loadConversation']>>>();
    const aDraft = deferred<Awaited<ReturnType<TuxWhatsAppApi['getDraft']>>>();

    client.loadConversation.mockImplementationOnce(() => aMessages.promise);
    client.getDraft.mockImplementationOnce(() => aDraft.promise);
    const selectA = controller.selectConversation('a');
    await settle();

    client.loadConversation.mockResolvedValueOnce(ok([message('b-message', 'b')]));
    client.getDraft.mockResolvedValueOnce(ok(draft('b', 'draft b')));
    await controller.selectConversation('b');

    aMessages.resolve(failure('STALE A ERROR'));
    aDraft.resolve(ok(draft('a', 'stale draft a')));
    await selectA;

    expect(controller.getState().selectedConversationId).toBe('b');
    expect(controller.getState().selectedMessages.map((item) => item.id)).toEqual(['b-message']);
    expect(controller.getState().composerText).toBe('draft b');
    expect(controller.getState().errorMessage).not.toBe('STALE A ERROR');
  });

  it('uses the same selection path after filter changes hide the current conversation', async () => {
    const unread = conversation('unread', {
      unreadCount: 3,
      lastMessageAt: '2026-09-03T12:00:02.000Z' as never,
    });
    const read = conversation('read', {
      unreadCount: 0,
      lastMessageAt: '2026-09-03T12:00:01.000Z' as never,
    });
    const { client, controller } = await loadController(snapshot([unread, read]));
    await controller.selectConversation('read');

    client.loadConversation.mockClear();
    client.getDraft.mockClear();
    controller.setFilter('UNREAD');
    await settle();

    expect(controller.getState().selectedConversationId).toBe('unread');
    expect(client.loadConversation).toHaveBeenCalledExactlyOnceWith('unread');
    expect(client.getDraft).toHaveBeenCalledExactlyOnceWith('unread');
  });
});

describe('WhatsAppInboxController draft ownership', () => {
  it('debounces draft persistence for exactly 250ms and performs exactly one save', async () => {
    const { client, controller, environment } = await loadController(snapshot([conversation('a')]));
    client.saveDraft.mockClear();

    controller.setComposerText('a');
    controller.setComposerText('ab');
    controller.setComposerText('abc');

    expect(client.saveDraft).not.toHaveBeenCalled();
    expect([...environment.timeouts.values()].map((item) => item.delayMs)).toEqual([250]);

    environment.fireTimeout(250);
    await settle();

    expect(client.saveDraft).toHaveBeenCalledExactlyOnceWith('a', 'abc');
  });

  it('captures the originating conversation and text for the delayed draft save', async () => {
    const a = conversation('a');
    const b = conversation('b');
    const { client, controller, environment } = await loadController(snapshot([a, b]));
    client.saveDraft.mockClear();

    controller.setComposerText('owned by a');
    environment.fireTimeout(250);
    const switchToB = controller.selectConversation('b');
    await settle();

    expect(client.saveDraft).toHaveBeenCalledWith('a', 'owned by a');
    await switchToB;
  });

  it('flushes the old pending draft before switching conversation ownership', async () => {
    const a = conversation('a');
    const b = conversation('b');
    const { client, controller } = await loadController(snapshot([a, b]));
    client.saveDraft.mockClear();
    client.loadConversation.mockClear();

    controller.setComposerText('pending a');
    await controller.selectConversation('b');

    expect(client.saveDraft).toHaveBeenCalledExactlyOnceWith('a', 'pending a');
    expect(client.loadConversation).toHaveBeenCalledWith('b');
    expect(client.saveDraft.mock.invocationCallOrder[0]).toBeLessThan(
      client.loadConversation.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it('flushes a pending draft before an explicit send', async () => {
    const { client, controller } = await loadController(snapshot([conversation('a')]));
    client.saveDraft.mockClear();
    client.sendText.mockClear();

    controller.setComposerText('send me');
    await controller.sendCurrentText();

    expect(client.saveDraft).toHaveBeenCalledWith('a', 'send me');
    expect(client.sendText).toHaveBeenCalledTimes(1);
    expect(client.saveDraft.mock.invocationCallOrder[0]).toBeLessThan(
      client.sendText.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it('keeps selection and composer intact when a required draft flush fails', async () => {
    const a = conversation('a');
    const b = conversation('b');
    const { client, controller } = await loadController(snapshot([a, b]));
    controller.setComposerText('do not lose me');
    client.saveDraft.mockResolvedValueOnce(failure('Draft save failed'));

    await controller.selectConversation('b');

    expect(controller.getState().selectedConversationId).toBe('a');
    expect(controller.getState().composerText).toBe('do not lose me');
    expect(controller.getState().errorMessage).toBe('Draft save failed');
    expect(client.loadConversation).not.toHaveBeenLastCalledWith('b');
  });

  it('best-effort flushes the pending draft and removes interval/listener/timeout ownership on stop', async () => {
    const env = new TestEnvironment();
    const client = createClient(snapshot([conversation('a')]));
    const controller = new WhatsAppInboxController(client.api, env);
    controller.start();
    await settle();
    client.saveDraft.mockClear();

    controller.setComposerText('flush on stop');
    expect(env.listenerCount()).toBe(3);
    expect(env.intervals.size).toBe(1);
    expect(env.timeouts.size).toBe(1);

    expect(() => controller.stop()).not.toThrow();
    await settle();

    expect(client.saveDraft).toHaveBeenCalledWith('a', 'flush on stop');
    expect(env.listenerCount()).toBe(0);
    expect(env.intervals.size).toBe(0);
    expect(env.timeouts.size).toBe(0);
  });
});

describe('WhatsAppInboxController send semantics', () => {
  it('inserts quick replies through the shared helper without sending', async () => {
    const { client, controller } = await loadController(snapshot([conversation('a')]));
    controller.setComposerText('existing');

    controller.insertQuickReply('reply');

    expect(controller.getState().composerText).toBe('existing\nreply');
    expect(client.sendText).not.toHaveBeenCalled();
  });

  it('reuses the exact outbound intent key for an unchanged failed send attempt', async () => {
    const { client, controller, environment } = await loadController(snapshot([conversation('a')]));
    client.sendText.mockResolvedValue(failure('Send failed'));
    controller.setComposerText('same text');

    await controller.sendCurrentText();
    await controller.sendCurrentText();

    expect(client.sendText).toHaveBeenCalledTimes(2);
    const first = client.sendText.mock.calls[0]?.[0];
    const second = client.sendText.mock.calls[1]?.[0];
    expect(first?.outboundIntentKey).toBe(second?.outboundIntentKey);
    expect(environment.createIntentKey).toHaveBeenCalledTimes(1);
    expect(controller.getState().composerText).toBe('same text');
  });

  it('creates a new outbound intent key after text changes following a failed attempt', async () => {
    const { client, controller, environment } = await loadController(snapshot([conversation('a')]));
    client.sendText.mockResolvedValue(failure('Send failed'));

    controller.setComposerText('first');
    await controller.sendCurrentText();
    controller.setComposerText('second');
    await controller.sendCurrentText();

    const first = client.sendText.mock.calls[0]?.[0];
    const second = client.sendText.mock.calls[1]?.[0];
    expect(first?.outboundIntentKey).not.toBe(second?.outboundIntentKey);
    expect(environment.createIntentKey).toHaveBeenCalledTimes(2);
  });

  it('preserves composer text and exposes only the safe error message after send failure', async () => {
    const { client, controller } = await loadController(snapshot([conversation('a')]));
    client.sendText.mockResolvedValueOnce(failure('Safe send failure'));
    controller.setComposerText('keep this');

    await controller.sendCurrentText();

    expect(controller.getState().composerText).toBe('keep this');
    expect(controller.getState().errorMessage).toBe('Safe send failure');
    expect(controller.getState().errorMessage).not.toContain('SECRET_CAUSE');
  });

  it('treats delivery uncertainty as an explicit failure and preserves text without replay', async () => {
    const { client, controller } = await loadController(snapshot([conversation('a')]));
    client.sendText.mockResolvedValueOnce(
      failure('WhatsApp delivery is not confirmed yet.', 'REMOTE_SYNC_ERROR'),
    );
    controller.setComposerText('uncertain');

    await controller.sendCurrentText();
    await settle();

    expect(controller.getState().composerText).toBe('uncertain');
    expect(client.sendText).toHaveBeenCalledTimes(1);
  });

  it('clears only the matching unchanged successful attempt, clears its persisted draft, and refreshes once', async () => {
    const { client, controller } = await loadController(snapshot([conversation('a')]));
    client.loadInbox.mockClear();
    client.loadInbox.mockResolvedValue(ok(snapshot([conversation('a')])));
    client.saveDraft.mockClear();
    controller.setComposerText('send success');

    await controller.sendCurrentText();

    expect(controller.getState().composerText).toBe('');
    expect(client.saveDraft).toHaveBeenCalledWith('a', 'send success');
    expect(client.saveDraft).toHaveBeenCalledWith('a', '');
    expect(client.loadInbox).toHaveBeenCalledTimes(1);
  });

  it('does not let an older successful send clear newer edited composer text', async () => {
    const { client, controller } = await loadController(snapshot([conversation('a')]));
    const pendingSend = deferred<Awaited<ReturnType<TuxWhatsAppApi['sendText']>>>();
    client.sendText.mockImplementationOnce(() => pendingSend.promise);
    client.loadInbox.mockResolvedValue(ok(snapshot([conversation('a')])));
    controller.setComposerText('old text');

    const sending = controller.sendCurrentText();
    await settle();
    controller.setComposerText('newer text');

    pendingSend.resolve(ok(message('sent-old', 'a', { direction: 'OUTBOUND' })));
    await sending;

    expect(controller.getState().composerText).toBe('newer text');
  });

  it('does not let Conversation A send completion clear Conversation B composer', async () => {
    const a = conversation('a');
    const b = conversation('b');
    const { client, controller } = await loadController(snapshot([a, b]));
    const pendingSend = deferred<Awaited<ReturnType<TuxWhatsAppApi['sendText']>>>();
    client.sendText.mockImplementationOnce(() => pendingSend.promise);
    client.loadInbox.mockResolvedValue(ok(snapshot([a, b])));

    controller.setComposerText('send from a');
    const sending = controller.sendCurrentText();
    await settle();

    client.getDraft.mockResolvedValueOnce(ok(draft('b', 'draft b')));
    await controller.selectConversation('b');
    controller.setComposerText('new b text');

    pendingSend.resolve(ok(message('sent-a', 'a', { direction: 'OUTBOUND' })));
    await sending;

    expect(controller.getState().selectedConversationId).toBe('b');
    expect(controller.getState().composerText).toBe('new b text');
  });

  it('never automatically retries or replays a failed send when connectivity returns', async () => {
    const env = new TestEnvironment();
    const client = createClient(snapshot([conversation('a')]));
    const controller = new WhatsAppInboxController(client.api, env);
    await controller.refresh();
    client.sendText.mockResolvedValueOnce(failure('failed once'));
    controller.setComposerText('manual retry only');
    await controller.sendCurrentText();
    expect(client.sendText).toHaveBeenCalledTimes(1);

    controller.start();
    env.fireOffline();
    env.fireOnline();
    await settle();

    expect(client.sendText).toHaveBeenCalledTimes(1);
  });

  it('returns without sending for no selection, blank text, or sendBusy', async () => {
    const env = new TestEnvironment();
    const emptyClient = createClient(snapshot());
    const emptyController = new WhatsAppInboxController(emptyClient.api, env);
    await emptyController.sendCurrentText();
    expect(emptyClient.sendText).not.toHaveBeenCalled();

    const { client, controller } = await loadController(snapshot([conversation('a')]));
    controller.setComposerText('   ');
    await controller.sendCurrentText();
    expect(client.sendText).not.toHaveBeenCalled();

    const pendingSend = deferred<Awaited<ReturnType<TuxWhatsAppApi['sendText']>>>();
    client.sendText.mockImplementationOnce(() => pendingSend.promise);
    controller.setComposerText('busy');
    const firstSend = controller.sendCurrentText();
    await settle();
    await controller.sendCurrentText();
    expect(client.sendText).toHaveBeenCalledTimes(1);
    pendingSend.resolve(ok(message('sent', 'a', { direction: 'OUTBOUND' })));
    await firstSend;
  });
});

describe('WhatsAppInboxController explicit mutations', () => {
  it('refreshes after successful markUnread', async () => {
    const { client, controller } = await loadController(snapshot([conversation('a')]));
    client.loadInbox.mockClear();

    await controller.markUnread('a');

    expect(client.markUnread).toHaveBeenCalledExactlyOnceWith('a');
    expect(client.loadInbox).toHaveBeenCalledTimes(1);
  });

  it('refreshes after successful archive mutation', async () => {
    const { client, controller } = await loadController(snapshot([conversation('a')]));
    client.loadInbox.mockClear();

    await controller.setArchived('a', true);

    expect(client.archive).toHaveBeenCalledExactlyOnceWith('a', true);
    expect(client.loadInbox).toHaveBeenCalledTimes(1);
  });

  it('refreshes after successful follow-up mutation', async () => {
    const { client, controller } = await loadController(snapshot([conversation('a')]));
    client.loadInbox.mockClear();

    await controller.setFollowUp('a', true);

    expect(client.setFollowUp).toHaveBeenCalledExactlyOnceWith('a', true);
    expect(client.loadInbox).toHaveBeenCalledTimes(1);
  });

  it('preserves the last good snapshot when a mutation fails', async () => {
    const { client, controller } = await loadController(snapshot([conversation('a')]));
    const previousSnapshot = controller.getState().snapshot;
    client.loadInbox.mockClear();
    client.archive.mockResolvedValueOnce(failure('Archive failed'));

    await controller.setArchived('a', true);

    expect(controller.getState().snapshot).toBe(previousSnapshot);
    expect(controller.getState().errorMessage).toBe('Archive failed');
    expect(client.loadInbox).not.toHaveBeenCalled();
  });
});

describe('createBrowserWhatsAppInboxEnvironment', () => {
  it('binds browser interval/timeout, visibility, connectivity, events, and random UUID', () => {
    const setIntervalMock = vi.fn(() => 101);
    const clearIntervalMock = vi.fn();
    const setTimeoutMock = vi.fn(() => 202);
    const clearTimeoutMock = vi.fn();
    const windowAdd = vi.fn();
    const windowRemove = vi.fn();
    const documentAdd = vi.fn();
    const documentRemove = vi.fn();

    vi.stubGlobal('window', {
      setInterval: setIntervalMock,
      clearInterval: clearIntervalMock,
      setTimeout: setTimeoutMock,
      clearTimeout: clearTimeoutMock,
      addEventListener: windowAdd,
      removeEventListener: windowRemove,
    });
    vi.stubGlobal('document', {
      hidden: true,
      addEventListener: documentAdd,
      removeEventListener: documentRemove,
    });
    vi.stubGlobal('navigator', { onLine: false });
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'opaque-browser-key') });

    const environment = createBrowserWhatsAppInboxEnvironment();
    const callback = vi.fn();

    expect(environment.nowMs()).toEqual(expect.any(Number));
    expect(environment.createIntentKey()).toBe('opaque-browser-key');
    expect(environment.isDocumentHidden()).toBe(true);
    expect(environment.isOnline()).toBe(false);
    expect(environment.setInterval(callback, 15_000)).toBe(101);
    expect(environment.setTimeout(callback, 250)).toBe(202);
    environment.clearInterval(101);
    environment.clearTimeout(202);

    const removeVisibility = environment.addVisibilityListener(callback);
    const removeOnline = environment.addOnlineListener(callback);
    const removeOffline = environment.addOfflineListener(callback);

    expect(documentAdd).toHaveBeenCalledWith('visibilitychange', callback);
    expect(windowAdd).toHaveBeenCalledWith('online', callback);
    expect(windowAdd).toHaveBeenCalledWith('offline', callback);

    removeVisibility();
    removeOnline();
    removeOffline();

    expect(documentRemove).toHaveBeenCalledWith('visibilitychange', callback);
    expect(windowRemove).toHaveBeenCalledWith('online', callback);
    expect(windowRemove).toHaveBeenCalledWith('offline', callback);
  });
});
