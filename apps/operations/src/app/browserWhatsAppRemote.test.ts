import { WhatsAppRemoteError } from '@tux/application';
import { parseEntityId, type BusinessDayId, type OrderId, type WorkerId } from '@tux/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VercelBrowserWhatsAppRemote } from './browserWhatsAppRemote';

const businessDayId = parseEntityId<BusinessDayId>('10000000-0000-4000-8000-000000000001');
const workerId = parseEntityId<WorkerId>('20000000-0000-4000-8000-000000000001');
const orderId = parseEntityId<OrderId>('30000000-0000-4000-8000-000000000001');
const conversationId = '40000000-0000-4000-8000-000000000001';
const messageId = '50000000-0000-4000-8000-000000000001';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function snapshot() {
  return {
    conversations: [],
    messages: [],
    quickReplies: [],
    orderLinks: [],
    nextCursor: null,
  };
}

function sentMessage() {
  return {
    id: messageId,
    shopId: '60000000-0000-4000-8000-000000000001',
    conversationId,
    providerMessageId: 'wamid.1',
    outboundIntentKey: 'intent-1',
    direction: 'OUTBOUND',
    kind: 'TEXT',
    text: 'أوردر حضرتك جاهز.',
    mediaRef: null,
    status: 'SENT',
    sentByWorkerId: workerId,
    initiatedByDeviceId: '70000000-0000-4000-8000-000000000001',
    initiatedAt: '2026-09-02T20:00:00.000Z',
    createdAt: '2026-09-02T20:00:00.000Z',
  };
}

function lastFetch(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit] {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error('fetch was not called');
  return call as unknown as [string, RequestInit];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('VercelBrowserWhatsAppRemote', () => {
  it('loads the inbox with same-origin credentials and no-store caching', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, snapshot()));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new VercelBrowserWhatsAppRemote().loadInbox()).resolves.toEqual(snapshot());

    expect(lastFetch(fetchMock)).toEqual([
      '/api/whatsapp',
      {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      },
    ]);
  });

  it('URL-encodes the inbox cursor', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, snapshot()));
    vi.stubGlobal('fetch', fetchMock);

    await new VercelBrowserWhatsAppRemote().loadInbox('2026-09-02T20:00:00.000Z+next?');

    expect(lastFetch(fetchMock)[0]).toBe(
      '/api/whatsapp?after=2026-09-02T20%3A00%3A00.000Z%2Bnext%3F',
    );
  });

  it('serializes SEND_MESSAGE with claims and payload only, then validates the returned message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { message: sentMessage() }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      new VercelBrowserWhatsAppRemote().sendText({
        businessDayId,
        workerId,
        conversationId,
        outboundIntentKey: 'intent-1',
        text: 'أوردر حضرتك جاهز.',
      }),
    ).resolves.toEqual(sentMessage());

    const [url, init] = lastFetch(fetchMock);
    expect(url).toBe('/api/whatsapp');
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
    });
    expect(JSON.parse(String(init.body))).toEqual({
      action: 'SEND_MESSAGE',
      businessDayId,
      workerId,
      conversationId,
      outboundIntentKey: 'intent-1',
      text: 'أوردر حضرتك جاهز.',
    });
    expect(String(init.body)).not.toMatch(
      /shopId|deviceId|sentByWorkerId|providerPhoneNumberId|recipient|token|kind/i,
    );
  });

  it('resolves the server messaging target without client authority fields', async () => {
    const target = {
      mode: 'TEMPLATE_ONLY',
      conversationId: null,
      normalizedPhone: '+201001234567',
      displayPhone: '01001234567',
      templates: [
        {
          id: '70000000-0000-4000-8000-000000000001',
          label: 'Start chat',
          languageCode: 'ar',
          previewText: 'أهلاً بحضرتك',
        },
      ],
      config: { storefrontUrl: 'https://menu.tux.example', storeLocation: null },
    };
    const fetchMock = vi.fn().mockResolvedValue(json(200, { target }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      new VercelBrowserWhatsAppRemote().resolveMessagingTarget({
        normalizedPhone: '+201001234567',
        displayPhone: '01001234567',
      }),
    ).resolves.toEqual(target);

    const [, init] = lastFetch(fetchMock);
    expect(JSON.parse(String(init.body))).toEqual({
      action: 'RESOLVE_TARGET',
      normalizedPhone: '+201001234567',
      displayPhone: '01001234567',
    });
    expect(String(init.body)).not.toMatch(/shopId|deviceId|workerId|provider|token|signedUrl/i);
  });

  it('sends only the TUX template id plus call-time claims', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { message: sentMessage() }));
    vi.stubGlobal('fetch', fetchMock);

    await new VercelBrowserWhatsAppRemote().sendTemplate({
      businessDayId,
      workerId,
      normalizedPhone: '+201001234567',
      displayPhone: '01001234567',
      templateId: '70000000-0000-4000-8000-000000000001',
      outboundIntentKey: 'intent-template',
    });

    const [, init] = lastFetch(fetchMock);
    expect(JSON.parse(String(init.body))).toEqual({
      action: 'SEND_TEMPLATE',
      businessDayId,
      workerId,
      normalizedPhone: '+201001234567',
      displayPhone: '01001234567',
      templateId: '70000000-0000-4000-8000-000000000001',
      outboundIntentKey: 'intent-template',
    });
    expect(String(init.body)).not.toMatch(
      /shopId|deviceId|providerTemplateName|languageCode|providerPhoneNumberId|token/i,
    );
  });

  it('rejects a successful SEND_MESSAGE payload that violates the WhatsApp message invariant', async () => {
    const invalidMessage = {
      ...sentMessage(),
      outboundIntentKey: null,
      sentByWorkerId: null,
      initiatedByDeviceId: null,
      initiatedAt: null,
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { message: invalidMessage })));

    await expect(
      new VercelBrowserWhatsAppRemote().sendText({
        businessDayId,
        workerId,
        conversationId,
        outboundIntentKey: 'intent-1',
        text: 'test',
      }),
    ).rejects.toThrow();
  });

  it('maps authoritative device rejection separately from transient remote unavailability', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json(401, { error: 'device_session_invalid' })),
    );

    await expect(new VercelBrowserWhatsAppRemote().loadInbox()).rejects.toMatchObject({
      code: 'DEVICE_AUTH_INVALID',
      messageId: null,
    });
  });

  it('maps Current Operator mismatch to a typed safe error', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          json(409, { error: 'whatsapp_operator_not_synchronized', diagnostic: 'hidden' }),
        ),
    );

    await expect(
      new VercelBrowserWhatsAppRemote().sendText({
        businessDayId,
        workerId,
        conversationId,
        outboundIntentKey: 'intent-1',
        text: 'test',
      }),
    ).rejects.toMatchObject({
      code: 'OPERATOR_NOT_SYNCHRONIZED',
      message: 'WhatsApp Current Operator is not synchronized.',
      messageId: null,
    });
  });

  it('maps durable outbound-intent conflict to a typed safe error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json(409, { error: 'whatsapp_outbound_intent_conflict' })),
    );

    await expect(
      new VercelBrowserWhatsAppRemote().sendText({
        businessDayId,
        workerId,
        conversationId,
        outboundIntentKey: 'intent-1',
        text: 'test',
      }),
    ).rejects.toMatchObject({
      code: 'OUTBOUND_INTENT_CONFLICT',
      message: 'WhatsApp outbound intent conflicts with an existing message.',
      messageId: null,
    });
  });

  it('maps delivery uncertainty to a typed error carrying only the durable message id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json(503, {
          error: 'whatsapp_delivery_uncertain',
          messageId,
          providerDiagnostic: 'must-not-surface',
        }),
      ),
    );

    let thrown: unknown;
    try {
      await new VercelBrowserWhatsAppRemote().sendText({
        businessDayId,
        workerId,
        conversationId,
        outboundIntentKey: 'intent-1',
        text: 'test',
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(WhatsAppRemoteError);
    expect(thrown).toMatchObject({ code: 'DELIVERY_UNCERTAIN', messageId });
    expect((thrown as Error).message).not.toContain('must-not-surface');
    expect(Object.keys(thrown as object).sort()).toEqual(['code', 'messageId', 'name'].sort());
  });

  it('serializes conversation-state mutations with documented fields only', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json(200, { status: 'OK' }));
    vi.stubGlobal('fetch', fetchMock);
    const remote = new VercelBrowserWhatsAppRemote();

    await remote.markUnread(conversationId);
    expect(JSON.parse(String(lastFetch(fetchMock)[1].body))).toEqual({
      action: 'MARK_UNREAD',
      conversationId,
    });

    await remote.archive(conversationId);
    expect(JSON.parse(String(lastFetch(fetchMock)[1].body))).toEqual({
      action: 'ARCHIVE',
      conversationId,
      archived: true,
    });

    await remote.archive(conversationId, false);
    expect(JSON.parse(String(lastFetch(fetchMock)[1].body))).toEqual({
      action: 'ARCHIVE',
      conversationId,
      archived: false,
    });

    await remote.setFollowUp(conversationId, true);
    expect(JSON.parse(String(lastFetch(fetchMock)[1].body))).toEqual({
      action: 'FOLLOW_UP',
      conversationId,
      followUp: true,
    });

    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit;
      expect(init.credentials).toBe('same-origin');
      expect(init.cache).toBe('no-store');
    }
  });

  it('links an order with Current Operator claims and no renderer authority fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { status: 'OK' }));
    vi.stubGlobal('fetch', fetchMock);

    await new VercelBrowserWhatsAppRemote().linkOrder({
      businessDayId,
      workerId,
      conversationId,
      orderId,
    });

    const init = lastFetch(fetchMock)[1];
    expect(JSON.parse(String(init.body))).toEqual({
      action: 'LINK_ORDER',
      businessDayId,
      workerId,
      conversationId,
      orderId,
      linked: true,
    });
    expect(String(init.body)).not.toMatch(/shopId|deviceId|sentByWorkerId|providerPhoneNumberId/i);
  });
});
