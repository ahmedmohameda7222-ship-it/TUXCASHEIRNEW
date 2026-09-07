import {
  parseEntityId,
  type BusinessDayId,
  type DeviceId,
  type OrderId,
  type ShopId,
  type WorkerId,
} from '@tux/domain';
import { describe, expect, it, vi } from 'vitest';
import {
  SupabaseWhatsAppOperationsRepository,
  WhatsAppOperationsRepositoryError,
} from './whatsappOperationsRepository';

const shopId = parseEntityId<ShopId>('00000000-0000-4000-8000-000000000001');
const businessDayId = parseEntityId<BusinessDayId>('00000000-0000-4000-8000-000000000002');
const workerId = parseEntityId<WorkerId>('00000000-0000-4000-8000-000000000003');
const deviceId = parseEntityId<DeviceId>('00000000-0000-4000-8000-000000000004');
const conversationId = '00000000-0000-4000-8000-000000000005';
const messageId = '00000000-0000-4000-8000-000000000006';
const orderId = parseEntityId<OrderId>('00000000-0000-4000-8000-000000000007');
const quickReplyId = '00000000-0000-4000-8000-000000000008';
const secondOrderId = parseEntityId<OrderId>('00000000-0000-4000-8000-000000000009');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function outboundMessageRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: messageId,
    shop_id: shopId,
    conversation_id: conversationId,
    provider_message_id: null,
    outbound_intent_key: 'intent-1',
    direction: 'OUTBOUND',
    kind: 'TEXT',
    text: 'أوردر حضرتك جاهز.',
    media_ref: null,
    media_metadata: {},
    status: 'PENDING',
    sent_by_worker_id: workerId,
    initiated_by_device_id: deviceId,
    initiated_at: '2026-09-02T20:00:00.000Z',
    provider_occurred_at: null,
    failure_code: null,
    failure_message: null,
    created_at: '2026-09-02T20:00:00.000Z',
    updated_at: '2026-09-02T20:00:01.000Z',
    ...overrides,
  };
}

function lastRequest(fetchMock: ReturnType<typeof vi.fn>): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error('fetch was not called');
  return { url: String(call[0]), init: (call[1] ?? {}) as RequestInit };
}

function lastRpcBody(fetchMock: ReturnType<typeof vi.fn>): unknown {
  const body = lastRequest(fetchMock).init.body;
  if (typeof body !== 'string') throw new Error('RPC body was not JSON');
  return JSON.parse(body);
}

function repository(fetchMock: ReturnType<typeof vi.fn>) {
  return new SupabaseWhatsAppOperationsRepository(
    {
      projectUrl: 'https://example.supabase.co',
      serviceRoleKey: 'test-service-role-key',
    },
    fetchMock as unknown as typeof fetch,
  );
}

describe('SupabaseWhatsAppOperationsRepository', () => {
  it('calls the Current Operator resolver with tenant-fenced claims and parses one row', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse([{ business_day_id: businessDayId, worker_id: workerId }]),
    );
    const result = await repository(fetchMock).resolveCurrentOperator({
      shopId,
      businessDayId,
      workerId,
    });

    expect(result).toEqual({ businessDayId, workerId });
    expect(lastRequest(fetchMock).url).toBe(
      'https://example.supabase.co/rest/v1/rpc/resolve_tux_whatsapp_current_operator_v1',
    );
    expect(lastRpcBody(fetchMock)).toEqual({
      p_shop_id: shopId,
      p_business_day_id: businessDayId,
      p_claimed_worker_id: workerId,
    });
  });

  it('maps an empty Current Operator result to null and rejects malformed success payloads safely', async () => {
    const emptyFetch = vi.fn(async () => jsonResponse([]));
    await expect(
      repository(emptyFetch).resolveCurrentOperator({ shopId, businessDayId, workerId }),
    ).resolves.toBeNull();

    const malformedFetch = vi.fn(async () => jsonResponse([{ worker_id: workerId }]));
    await expect(
      repository(malformedFetch).resolveCurrentOperator({ shopId, businessDayId, workerId }),
    ).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' });
  });

  it('atomically claims a text intent with worker/device claims and parses the durable result', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse([
        {
          created: true,
          recipient_normalized_phone: '01012345678',
          message_json: outboundMessageRow(),
        },
      ]),
    );

    const result = await repository(fetchMock).claimOutboundTextIntent({
      shopId,
      businessDayId,
      workerId,
      deviceId,
      conversationId,
      outboundIntentKey: 'intent-1',
      text: 'أوردر حضرتك جاهز.',
      initiatedAt: '2026-09-02T20:00:00.000Z',
    });

    expect(lastRequest(fetchMock).url).toBe(
      'https://example.supabase.co/rest/v1/rpc/claim_tux_whatsapp_outbound_intent_v2',
    );
    expect(lastRpcBody(fetchMock)).toEqual({
      p_shop_id: shopId,
      p_business_day_id: businessDayId,
      p_claimed_worker_id: workerId,
      p_device_id: deviceId,
      p_conversation_id: conversationId,
      p_outbound_intent_key: 'intent-1',
      p_kind: 'TEXT',
      p_text: 'أوردر حضرتك جاهز.',
      p_media_ref: null,
      p_media_metadata: {},
      p_initiated_at: '2026-09-02T20:00:00.000Z',
    });
    expect(result).toMatchObject({
      created: true,
      recipientNormalizedPhone: '01012345678',
      message: {
        id: messageId,
        shopId,
        conversationId,
        outboundIntentKey: 'intent-1',
        status: 'PENDING',
        sentByWorkerId: workerId,
        initiatedByDeviceId: deviceId,
      },
    });
  });

  it('uses the approved RPCs for attach, state, failure, and worker-authorized order linking', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(null));
    const remote = repository(fetchMock);

    await remote.attachProviderMessage({ shopId, messageId, providerMessageId: 'wamid.1' });
    expect(lastRequest(fetchMock).url).toContain('/rpc/attach_tux_whatsapp_provider_message_v1');
    expect(lastRpcBody(fetchMock)).toEqual({
      p_shop_id: shopId,
      p_message_id: messageId,
      p_provider_message_id: 'wamid.1',
      p_status: 'SENT',
    });

    await remote.setConversationState({
      shopId,
      conversationId,
      archived: true,
      followUp: null,
      markUnread: false,
    });
    expect(lastRequest(fetchMock).url).toContain('/rpc/set_tux_whatsapp_conversation_state_v1');
    expect(lastRpcBody(fetchMock)).toEqual({
      p_shop_id: shopId,
      p_conversation_id: conversationId,
      p_archived: true,
      p_follow_up: null,
      p_mark_unread: false,
    });

    await remote.failOutboundIntent({
      shopId,
      messageId,
      failureCode: '131026',
      failureMessage: 'WhatsApp provider rejected the request.',
    });
    expect(lastRequest(fetchMock).url).toContain('/rpc/fail_tux_whatsapp_outbound_intent_v1');

    await remote.linkOrderAuthorized({
      shopId,
      businessDayId,
      workerId,
      deviceId,
      conversationId,
      orderId,
      linked: true,
    });
    expect(lastRequest(fetchMock).url).toContain(
      '/rpc/link_tux_whatsapp_conversation_order_authorized_v1',
    );
    expect(lastRpcBody(fetchMock)).toEqual({
      p_shop_id: shopId,
      p_business_day_id: businessDayId,
      p_claimed_worker_id: workerId,
      p_device_id: deviceId,
      p_conversation_id: conversationId,
      p_order_id: orderId,
      p_linked: true,
    });
  });

  it('loads inbox data, computes a monotonic cursor, and exposes one linked order only when unambiguous', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        conversations: [
          {
            id: conversationId,
            shop_id: shopId,
            normalized_phone: '01012345678',
            display_phone: '+201012345678',
            customer_contact_id: null,
            customer_name: 'Ahmed',
            context: 'ORDER_LINKED',
            unread_count: 1,
            archived: false,
            follow_up: true,
            last_message_at: '2026-09-02T20:00:00.000Z',
          },
        ],
        messages: [
          outboundMessageRow({ updated_at: '2026-09-02T20:00:03.000Z' }),
          outboundMessageRow({
            id: '00000000-0000-4000-8000-000000000010',
            outbound_intent_key: 'intent-2',
            updated_at: '2026-09-02T20:00:05.000Z',
          }),
        ],
        quickReplies: [
          {
            id: quickReplyId,
            shop_id: shopId,
            category: 'DELIVERY',
            language: 'ar-EG',
            text: 'أوردر حضرتك جاهز.',
            usage_count: 2,
            active: true,
          },
        ],
        orderLinks: [
          {
            id: '00000000-0000-4000-8000-000000000011',
            shop_id: shopId,
            conversation_id: conversationId,
            order_id: orderId,
            linked_by_worker_id: workerId,
            initiated_by_device_id: deviceId,
            linked_at: '2026-09-02T19:00:00.000Z',
            unlinked_at: null,
          },
        ],
      }),
    );

    const snapshot = await repository(fetchMock).loadInbox({
      shopId,
      after: '2026-09-02T19:59:59.000Z',
    });

    expect(lastRequest(fetchMock).url).toContain('/rpc/get_tux_whatsapp_inbox_v2');
    expect(lastRpcBody(fetchMock)).toEqual({
      p_shop_id: shopId,
      p_cursor: '2026-09-02T19:59:59.000Z',
    });
    expect(snapshot.nextCursor).toBe('2026-09-02T20:00:05.000Z');
    expect(snapshot.conversations[0]).toMatchObject({ linkedOrderId: orderId });
    expect(snapshot.orderLinks).toEqual([
      {
        conversationId,
        orderId,
        linkedAt: '2026-09-02T19:00:00.000Z',
      },
    ]);
  });

  it('preserves the input cursor with no newer messages and clears ambiguous linkedOrderId', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        conversations: [
          {
            id: conversationId,
            shop_id: shopId,
            normalized_phone: '01012345678',
            display_phone: '+201012345678',
            customer_contact_id: null,
            customer_name: null,
            context: 'ORDER_LINKED',
            unread_count: 0,
            archived: false,
            follow_up: false,
            last_message_at: null,
          },
        ],
        messages: [],
        quickReplies: [],
        orderLinks: [
          {
            conversation_id: conversationId,
            order_id: orderId,
            linked_at: '2026-09-02T18:00:00.000Z',
          },
          {
            conversation_id: conversationId,
            order_id: secondOrderId,
            linked_at: '2026-09-02T19:00:00.000Z',
          },
        ],
      }),
    );

    const snapshot = await repository(fetchMock).loadInbox({
      shopId,
      after: '2026-09-02T20:00:05.000Z',
    });
    expect(snapshot.nextCursor).toBe('2026-09-02T20:00:05.000Z');
    expect(snapshot.conversations[0]?.linkedOrderId).toBeNull();
    expect(snapshot.orderLinks).toHaveLength(2);
  });

  it('keeps the service credential only in trusted RPC headers', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]));
    await repository(fetchMock).resolveCurrentOperator({ shopId, businessDayId, workerId });

    const request = lastRequest(fetchMock);
    expect(request.url).not.toContain('test-service-role-key');
    expect(String(request.init.body)).not.toContain('test-service-role-key');
    expect(request.init.headers).toMatchObject({
      apikey: 'test-service-role-key',
      Authorization: 'Bearer test-service-role-key',
      'Content-Type': 'application/json',
    });
  });

  it('maps only approved Postgres authority exceptions and never leaks remote bodies', async () => {
    const operatorFetch = vi.fn(async () =>
      jsonResponse(
        { message: 'TUX_WHATSAPP_OPERATOR_NOT_SYNCHRONIZED', secret: 'do-not-leak' },
        400,
      ),
    );
    await expect(
      repository(operatorFetch).claimOutboundTextIntent({
        shopId,
        businessDayId,
        workerId,
        deviceId,
        conversationId,
        outboundIntentKey: 'intent-1',
        text: 'hello',
        initiatedAt: '2026-09-02T20:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'OPERATOR_NOT_SYNCHRONIZED' });

    const conflictFetch = vi.fn(async () =>
      jsonResponse({ message: 'TUX_WHATSAPP_OUTBOUND_INTENT_CONFLICT' }, 400),
    );
    await expect(
      repository(conflictFetch).claimOutboundTextIntent({
        shopId,
        businessDayId,
        workerId,
        deviceId,
        conversationId,
        outboundIntentKey: 'intent-1',
        text: 'hello',
        initiatedAt: '2026-09-02T20:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'OUTBOUND_INTENT_CONFLICT' });

    const remoteFetch = vi.fn(async () =>
      jsonResponse({ message: 'db detail', secret: 'do-not-leak' }, 500),
    );
    let caught: unknown;
    try {
      await repository(remoteFetch).resolveCurrentOperator({ shopId, businessDayId, workerId });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(WhatsAppOperationsRepositoryError);
    expect(caught).toMatchObject({ code: 'REMOTE_REJECTED' });
    expect(String(caught)).not.toContain('do-not-leak');
    expect(String(caught)).not.toContain('db detail');
  });

  it('maps network failures to REMOTE_UNAVAILABLE and invalid message invariants to PROTOCOL_ERROR', async () => {
    const unavailableFetch = vi.fn(async () => {
      throw new Error('network detail');
    });
    await expect(
      repository(unavailableFetch).resolveCurrentOperator({ shopId, businessDayId, workerId }),
    ).rejects.toMatchObject({ code: 'REMOTE_UNAVAILABLE' });

    const invalidMessageFetch = vi.fn(async () =>
      jsonResponse([
        {
          created: true,
          recipient_normalized_phone: '01012345678',
          message_json: outboundMessageRow({ sent_by_worker_id: null }),
        },
      ]),
    );
    await expect(
      repository(invalidMessageFetch).claimOutboundTextIntent({
        shopId,
        businessDayId,
        workerId,
        deviceId,
        conversationId,
        outboundIntentKey: 'intent-1',
        text: 'hello',
        initiatedAt: '2026-09-02T20:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' });
  });
});

describe('Task 8D repository policy RPCs', () => {
  it('resolves safe messaging policy/config/templates through the service-role RPC', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse([
        {
          conversation_id: conversationId,
          normalized_phone: '01012345678',
          display_phone: '+201012345678',
          last_inbound_at: '2026-09-02T19:00:00.000Z',
          free_form_until: '2026-09-03T19:00:00.000Z',
          storefront_url: 'https://menu.tux.example',
          store_latitude: null,
          store_longitude: null,
          store_location_label: null,
          store_location_address: null,
          templates_json: [
            {
              id: '00000000-0000-4000-8000-000000000021',
              label: 'ابدأ المحادثة',
              languageCode: 'ar',
              previewText: 'أهلاً بحضرتك من TUX.',
            },
          ],
        },
      ]),
    );
    const remote = repository(fetchMock);
    const method = Reflect.get(remote, 'resolveMessagingPolicy') as unknown;
    expect(method).toEqual(expect.any(Function));

    const resolveMessagingPolicy = method as (input: {
      shopId: ShopId;
      conversationId: string;
    }) => Promise<unknown>;
    const result = await resolveMessagingPolicy.call(remote, { shopId, conversationId });

    expect(lastRequest(fetchMock).url).toContain('/rpc/get_tux_whatsapp_messaging_policy_v1');
    expect(lastRpcBody(fetchMock)).toEqual({
      p_shop_id: shopId,
      p_conversation_id: conversationId,
    });
    expect(result).toEqual({
      conversationId,
      normalizedPhone: '01012345678',
      displayPhone: '+201012345678',
      lastInboundAt: '2026-09-02T19:00:00.000Z',
      freeFormUntil: '2026-09-03T19:00:00.000Z',
      templates: [
        {
          id: '00000000-0000-4000-8000-000000000021',
          label: 'ابدأ المحادثة',
          languageCode: 'ar',
          previewText: 'أهلاً بحضرتك من TUX.',
        },
      ],
      config: { storefrontUrl: 'https://menu.tux.example', storeLocation: null },
    });
  });
});
