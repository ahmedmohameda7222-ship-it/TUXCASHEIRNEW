import {
  instant,
  parseEntityId,
  type BusinessDayId,
  type ShopId,
  type WorkerId,
} from '@tux/domain';
import { describe, expect, it, vi } from 'vitest';
import type { OperationsSessionResult } from './session';
import type { WhatsAppRemoteGateway } from './whatsappRemote';
import { OperationsWhatsAppMessagingService } from './whatsappMessaging';

const shopId = parseEntityId<ShopId>('10000000-0000-4000-8000-000000000001');
const businessDayId = parseEntityId<BusinessDayId>('20000000-0000-4000-8000-000000000001');
const workerId = parseEntityId<WorkerId>('30000000-0000-4000-8000-000000000001');
const workerId2 = parseEntityId<WorkerId>('30000000-0000-4000-8000-000000000002');
const conversationId = '40000000-0000-4000-8000-000000000001';

function active(worker = workerId): OperationsSessionResult {
  return {
    ok: true,
    value: {
      status: 'ACTIVE',
      shopId,
      businessDayId,
      businessDayStartedAt: instant('2026-09-04T08:00:00.000Z'),
      operator: { id: worker, displayName: 'Worker' },
    },
  };
}

function remote(): WhatsAppRemoteGateway {
  return {
    loadInbox: vi.fn().mockResolvedValue({
      conversations: [],
      messages: [],
      quickReplies: [],
      orderLinks: [],
      nextCursor: null,
    }),
    resolveMessagingTarget: vi.fn().mockResolvedValue({
      mode: 'FREE_FORM',
      conversationId,
      freeFormUntil: instant('2026-09-05T08:00:00.000Z'),
      config: { storefrontUrl: 'https://menu.tux.example', storeLocation: null },
    }),
    sendText: vi.fn(),
    sendMedia: vi.fn(),
    sendLocation: vi.fn(),
    sendTemplate: vi.fn().mockResolvedValue({
      id: '50000000-0000-4000-8000-000000000001',
      shopId,
      conversationId,
      providerMessageId: 'wamid.template',
      outboundIntentKey: 'intent-template',
      direction: 'OUTBOUND',
      kind: 'TEXT',
      text: 'أهلاً بحضرتك',
      mediaRef: null,
      status: 'SENT',
      sentByWorkerId: workerId,
      initiatedByDeviceId: parseEntityId('60000000-0000-4000-8000-000000000001'),
      initiatedAt: instant('2026-09-04T10:00:00.000Z'),
      createdAt: instant('2026-09-04T10:00:00.000Z'),
    }),
    retryFailedMessage: vi.fn(),
    getMediaAccess: vi.fn(),
    markUnread: vi.fn(),
    archive: vi.fn(),
    setFollowUp: vi.fn(),
    linkOrder: vi.fn(),
  };
}

describe('OperationsWhatsAppMessagingService', () => {
  it('resolves messaging target without accepting client tenant or worker authority', async () => {
    const gateway = remote();
    const service = new OperationsWhatsAppMessagingService(gateway, {
      getState: async () => active(),
    });

    const result = await service.resolveMessagingTarget({
      normalizedPhone: '+201001234567',
      displayPhone: '01001234567',
    });

    expect(result).toMatchObject({ ok: true, value: { mode: 'FREE_FORM', conversationId } });
    expect(gateway.resolveMessagingTarget).toHaveBeenCalledWith({
      normalizedPhone: '+201001234567',
      displayPhone: '01001234567',
    });
  });

  it('resolves ACTIVE Current Operator claims at template-send call time', async () => {
    const gateway = remote();
    let state = active();
    const service = new OperationsWhatsAppMessagingService(gateway, {
      getState: async () => state,
    });

    await service.sendTemplate({
      normalizedPhone: '+201001234567',
      displayPhone: '01001234567',
      templateId: '70000000-0000-4000-8000-000000000001',
      outboundIntentKey: 'intent-template',
    });
    state = active(workerId2);
    await service.sendTemplate({
      normalizedPhone: '+201001234567',
      displayPhone: '01001234567',
      templateId: '70000000-0000-4000-8000-000000000001',
      outboundIntentKey: 'intent-template-2',
    });

    expect(gateway.sendTemplate).toHaveBeenNthCalledWith(1, {
      businessDayId,
      workerId,
      normalizedPhone: '+201001234567',
      displayPhone: '01001234567',
      templateId: '70000000-0000-4000-8000-000000000001',
      outboundIntentKey: 'intent-template',
    });
    expect(gateway.sendTemplate).toHaveBeenNthCalledWith(2, {
      businessDayId,
      workerId: workerId2,
      normalizedPhone: '+201001234567',
      displayPhone: '01001234567',
      templateId: '70000000-0000-4000-8000-000000000001',
      outboundIntentKey: 'intent-template-2',
    });
  });

  it('rejects template send when there is no ACTIVE Current Operator', async () => {
    const gateway = remote();
    const service = new OperationsWhatsAppMessagingService(gateway, {
      getState: async () => ({ ok: true, value: { status: 'NO_ACTIVE_DAY', shopId } }),
    });

    const result = await service.sendTemplate({
      normalizedPhone: '+201001234567',
      displayPhone: '01001234567',
      templateId: '70000000-0000-4000-8000-000000000001',
      outboundIntentKey: 'intent-template',
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'CONFLICT_ERROR' } });
    expect(gateway.sendTemplate).not.toHaveBeenCalled();
  });
});
