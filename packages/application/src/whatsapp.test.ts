import {
  instant,
  parseEntityId,
  type BusinessDayId,
  type OrderId,
  type ShopId,
  type WhatsAppMessage,
  type WorkerId,
} from '@tux/domain';
import type { WhatsAppStore } from '@tux/persistence';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperationsSessionResult } from './session';
import {
  WhatsAppRemoteError,
  type WhatsAppInboxSnapshot,
  type WhatsAppRemoteGateway,
} from './whatsappRemote';
import { OperationsWhatsAppService } from './whatsapp';

const shopId = parseEntityId<ShopId>('10000000-0000-4000-8000-000000000001');
const businessDayId = parseEntityId<BusinessDayId>('20000000-0000-4000-8000-000000000001');
const workerId = parseEntityId<WorkerId>('30000000-0000-4000-8000-000000000001');
const workerId2 = parseEntityId<WorkerId>('30000000-0000-4000-8000-000000000002');
const orderId = parseEntityId<OrderId>('40000000-0000-4000-8000-000000000001');
const conversationId = '50000000-0000-4000-8000-000000000001';
const now = instant('2026-09-03T10:00:00.000Z');

function active(worker = workerId): OperationsSessionResult {
  return {
    ok: true,
    value: {
      status: 'ACTIVE',
      shopId,
      businessDayId,
      businessDayStartedAt: instant('2026-09-03T08:00:00.000Z'),
      operator: { id: worker, displayName: worker === workerId ? 'Worker One' : 'Worker Two' },
    },
  };
}

function sentMessage(): WhatsAppMessage {
  return {
    id: '60000000-0000-4000-8000-000000000001',
    shopId,
    conversationId,
    providerMessageId: 'wamid.1',
    outboundIntentKey: 'intent-1',
    direction: 'OUTBOUND',
    kind: 'TEXT',
    text: 'تمام',
    mediaRef: null,
    media: null,
    location: null,
    status: 'SENT',
    sentByWorkerId: workerId,
    initiatedByDeviceId: parseEntityId('70000000-0000-4000-8000-000000000001'),
    initiatedAt: now,
    createdAt: now,
  };
}

function remoteSnapshot(): WhatsAppInboxSnapshot {
  return {
    conversations: [],
    messages: [sentMessage()],
    quickReplies: [],
    orderLinks: [],
    nextCursor: 'cursor-2',
  };
}

function remoteError(code: string, messageId: string | null = null): Error {
  return Object.assign(new Error('safe remote error'), { code, messageId });
}

function createRemote(): WhatsAppRemoteGateway {
  return {
    loadInbox: vi.fn().mockResolvedValue(remoteSnapshot()),
    resolveMessagingTarget: vi.fn().mockRejectedValue(new Error('not called')),
    sendText: vi.fn().mockResolvedValue(sentMessage()),
    sendTemplate: vi.fn().mockRejectedValue(new Error('not called')),
    markUnread: vi.fn().mockResolvedValue(undefined),
    archive: vi.fn().mockResolvedValue(undefined),
    setFollowUp: vi.fn().mockResolvedValue(undefined),
    linkOrder: vi.fn().mockResolvedValue(undefined),
  };
}

function createStore(): WhatsAppStore {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    upsertRemoteSnapshot: vi.fn().mockResolvedValue(undefined),
    upsertMessage: vi.fn().mockResolvedValue(undefined),
    loadInbox: vi.fn().mockResolvedValue({
      conversations: [],
      messages: [sentMessage()],
      quickReplies: [],
      orderLinks: [],
    }),
    listMessages: vi.fn().mockResolvedValue([sentMessage()]),
    saveDraft: vi.fn().mockResolvedValue(undefined),
    getDraft: vi.fn().mockResolvedValue(null),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createSessionSource(initial: OperationsSessionResult = active()) {
  let current = initial;
  return {
    getState: vi.fn(async () => current),
    set(next: OperationsSessionResult) {
      current = next;
    },
  };
}

describe('OperationsWhatsAppService', () => {
  let remote: WhatsAppRemoteGateway;
  let store: WhatsAppStore;
  let session: ReturnType<typeof createSessionSource>;

  beforeEach(() => {
    remote = createRemote();
    store = createStore();
    session = createSessionSource();
  });

  it('resolves ACTIVE Current Operator claims at call time and forwards only the Task 4 send contract', async () => {
    const service = new OperationsWhatsAppService(remote, store, session, () => now);

    const first = await service.sendText({
      conversationId,
      text: 'تمام',
      outboundIntentKey: 'intent-1',
    });
    expect(first.ok).toBe(true);
    expect(remote.sendText).toHaveBeenNthCalledWith(1, {
      businessDayId,
      workerId,
      conversationId,
      outboundIntentKey: 'intent-1',
      text: 'تمام',
    });

    session.set(active(workerId2));
    await service.sendText({ conversationId, text: 'ثاني', outboundIntentKey: 'intent-2' });
    expect(remote.sendText).toHaveBeenNthCalledWith(2, {
      businessDayId,
      workerId: workerId2,
      conversationId,
      outboundIntentKey: 'intent-2',
      text: 'ثاني',
    });
  });

  it.each([
    {
      status: 'CONFIGURATION_REQUIRED' as const,
      state: { status: 'CONFIGURATION_REQUIRED' as const, message: 'not configured' },
    },
    {
      status: 'NO_ACTIVE_DAY' as const,
      state: { status: 'NO_ACTIVE_DAY' as const, shopId },
    },
    {
      status: 'SIGN_IN_REQUIRED' as const,
      state: {
        status: 'SIGN_IN_REQUIRED' as const,
        shopId,
        businessDayId,
        businessDayStartedAt: instant('2026-09-03T08:00:00.000Z'),
      },
    },
  ])('returns CONFLICT_ERROR and does not send when session is $status', async ({ state }) => {
    session.set({ ok: true, value: state });
    const service = new OperationsWhatsAppService(remote, store, session, () => now);

    const result = await service.sendText({
      conversationId,
      text: 'تمام',
      outboundIntentKey: 'intent-1',
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'CONFLICT_ERROR' } });
    expect(remote.sendText).not.toHaveBeenCalled();
  });

  it('maps OPERATOR_NOT_SYNCHRONIZED to CONFLICT_ERROR without changing the worker or retrying', async () => {
    vi.mocked(remote.sendText).mockRejectedValue(remoteError('OPERATOR_NOT_SYNCHRONIZED'));
    const service = new OperationsWhatsAppService(remote, store, session, () => now);

    const result = await service.sendText({
      conversationId,
      text: 'تمام',
      outboundIntentKey: 'intent-1',
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'CONFLICT_ERROR' } });
    expect(remote.sendText).toHaveBeenCalledTimes(1);
    expect(remote.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ workerId, outboundIntentKey: 'intent-1' }),
    );
  });

  it('maps OUTBOUND_INTENT_CONFLICT to CONFLICT_ERROR without retry', async () => {
    vi.mocked(remote.sendText).mockRejectedValue(remoteError('OUTBOUND_INTENT_CONFLICT'));
    const service = new OperationsWhatsAppService(remote, store, session, () => now);

    const result = await service.sendText({
      conversationId,
      text: 'تمام',
      outboundIntentKey: 'intent-1',
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'CONFLICT_ERROR' } });
    expect(remote.sendText).toHaveBeenCalledTimes(1);
  });

  it('surfaces a closed free-form window as a dedicated application error for one-shot target refresh', async () => {
    remote.sendText = vi
      .fn()
      .mockRejectedValue(new WhatsAppRemoteError('FREE_FORM_WINDOW_CLOSED', 'window closed'));
    const service = new OperationsWhatsAppService(remote, store, session, () => now);

    const result = await service.sendText({
      conversationId,
      text: 'تمام',
      outboundIntentKey: 'intent-1',
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'WHATSAPP_FREE_FORM_WINDOW_CLOSED' },
    });
    expect(remote.sendText).toHaveBeenCalledTimes(1);
  });

  it('maps DELIVERY_UNCERTAIN to REMOTE_SYNC_ERROR and never resends or changes the intent key', async () => {
    vi.mocked(remote.sendText).mockRejectedValue(
      remoteError('DELIVERY_UNCERTAIN', '60000000-0000-4000-8000-000000000001'),
    );
    const service = new OperationsWhatsAppService(remote, store, session, () => now);

    const result = await service.sendText({
      conversationId,
      text: 'تمام',
      outboundIntentKey: 'intent-1',
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'REMOTE_SYNC_ERROR' } });
    expect(remote.sendText).toHaveBeenCalledTimes(1);
    expect(remote.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ workerId, outboundIntentKey: 'intent-1' }),
    );
  });

  it('caches a successful remote inbox snapshot and returns that remote snapshot', async () => {
    const service = new OperationsWhatsAppService(remote, store, session, () => now);

    const result = await service.loadInbox('cursor-1');

    expect(result).toEqual({ ok: true, value: remoteSnapshot() });
    expect(remote.loadInbox).toHaveBeenCalledWith('cursor-1');
    expect(store.upsertRemoteSnapshot).toHaveBeenCalledTimes(1);
    expect(store.upsertRemoteSnapshot).toHaveBeenCalledWith(remoteSnapshot());
  });

  it('falls back to the current shop cache when the inbox remote is unavailable', async () => {
    vi.mocked(remote.loadInbox).mockRejectedValue(remoteError('REMOTE_UNAVAILABLE'));
    const service = new OperationsWhatsAppService(remote, store, session, () => now);

    const result = await service.loadInbox();

    expect(result).toEqual({
      ok: true,
      value: {
        conversations: [],
        messages: [sentMessage()],
        quickReplies: [],
        orderLinks: [],
        nextCursor: null,
      },
    });
    expect(store.loadInbox).toHaveBeenCalledWith(shopId);
  });

  it('does not treat authoritative device invalidation as transient cached-offline availability', async () => {
    vi.mocked(remote.loadInbox).mockRejectedValue(
      new WhatsAppRemoteError('DEVICE_AUTH_INVALID', 'Device session is invalid.'),
    );
    const service = new OperationsWhatsAppService(remote, store, session, () => now);

    const result = await service.loadInbox();

    expect(result).toMatchObject({ ok: false, error: { code: 'REMOTE_SYNC_ERROR' } });
    expect(store.loadInbox).not.toHaveBeenCalled();
  });

  it('upserts a successful durable outbound message locally exactly once', async () => {
    const service = new OperationsWhatsAppService(remote, store, session, () => now);

    const result = await service.sendText({
      conversationId,
      text: 'تمام',
      outboundIntentKey: 'intent-1',
    });

    expect(result).toEqual({ ok: true, value: sentMessage() });
    expect(store.upsertMessage).toHaveBeenCalledTimes(1);
    expect(store.upsertMessage).toHaveBeenCalledWith(sentMessage());
    expect(remote.sendText).toHaveBeenCalledTimes(1);
  });

  it('returns LOCAL_PERSISTENCE_ERROR after remote send success if cache write fails, without a second send', async () => {
    vi.mocked(store.upsertMessage).mockRejectedValue(new Error('disk failed'));
    const service = new OperationsWhatsAppService(remote, store, session, () => now);

    const result = await service.sendText({
      conversationId,
      text: 'تمام',
      outboundIntentKey: 'intent-1',
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'LOCAL_PERSISTENCE_ERROR' } });
    expect(remote.sendText).toHaveBeenCalledTimes(1);
    expect(store.upsertMessage).toHaveBeenCalledTimes(1);
  });

  it('saves and loads drafts locally without invoking the WhatsApp remote gateway', async () => {
    vi.mocked(store.getDraft).mockResolvedValue({
      shopId,
      conversationId,
      text: 'مسودة',
      updatedAt: now,
    });
    const service = new OperationsWhatsAppService(remote, store, session, () => now);

    await expect(service.saveDraft(conversationId, 'مسودة')).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await expect(service.getDraft(conversationId)).resolves.toEqual({
      ok: true,
      value: { shopId, conversationId, text: 'مسودة', updatedAt: now },
    });
    expect(store.saveDraft).toHaveBeenCalledWith({
      shopId,
      conversationId,
      text: 'مسودة',
      updatedAt: now,
    });
    expect(store.getDraft).toHaveBeenCalledWith(shopId, conversationId);
    expect(remote.loadInbox).not.toHaveBeenCalled();
    expect(remote.sendText).not.toHaveBeenCalled();
    expect(remote.markUnread).not.toHaveBeenCalled();
    expect(remote.archive).not.toHaveBeenCalled();
    expect(remote.setFollowUp).not.toHaveBeenCalled();
    expect(remote.linkOrder).not.toHaveBeenCalled();
  });

  it('requires ACTIVE state for linkOrder and forwards only businessDayId + workerId claims', async () => {
    const service = new OperationsWhatsAppService(remote, store, session, () => now);

    await expect(service.linkOrder({ conversationId, orderId })).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    expect(remote.linkOrder).toHaveBeenCalledWith({
      businessDayId,
      workerId,
      conversationId,
      orderId,
    });

    session.set({ ok: true, value: { status: 'NO_ACTIVE_DAY', shopId } });
    const rejected = await service.linkOrder({ conversationId, orderId, linked: false });
    expect(rejected).toMatchObject({ ok: false, error: { code: 'CONFLICT_ERROR' } });
    expect(remote.linkOrder).toHaveBeenCalledTimes(1);
  });

  it('uses Task 4 conversation mutation methods without manufacturing worker authority fields', async () => {
    const service = new OperationsWhatsAppService(remote, store, session, () => now);

    await expect(service.markUnread(conversationId)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await expect(service.archive(conversationId)).resolves.toEqual({ ok: true, value: undefined });
    await expect(service.setFollowUp(conversationId, true)).resolves.toEqual({
      ok: true,
      value: undefined,
    });

    expect(remote.markUnread).toHaveBeenCalledWith(conversationId);
    expect(remote.archive).toHaveBeenCalledWith(conversationId, undefined);
    expect(remote.setFollowUp).toHaveBeenCalledWith(conversationId, true);
  });

  it('loads a conversation only from the currently resolved local shop cache', async () => {
    const service = new OperationsWhatsAppService(remote, store, session, () => now);

    const result = await service.loadConversation(conversationId);

    expect(result).toEqual({ ok: true, value: [sentMessage()] });
    expect(store.listMessages).toHaveBeenCalledWith(shopId, conversationId);
    expect(remote.loadInbox).not.toHaveBeenCalled();
  });
});
