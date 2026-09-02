import {
  instant,
  parseEntityId,
  type BusinessDayId,
  type DeviceId,
  type OrderId,
  type ShopId,
  type WhatsAppMessage,
  type WhatsAppMessageStatus,
  type WorkerId,
} from '@tux/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayRequest, GatewayResponse } from './supabaseGateway';
import type { WhatsAppOperationsRepository } from './whatsappOperationsRepository';
import { WhatsAppOperationsRepositoryError } from './whatsappOperationsRepository';
import {
  handleWhatsAppOperations,
  type WhatsAppOperationsDependencyFactory,
} from './whatsappOperationsGateway';
import { WhatsAppProviderError } from './whatsappProviderGateway';

const shopId = parseEntityId<ShopId>('00000000-0000-4000-8000-000000000001');
const businessDayId = parseEntityId<BusinessDayId>('00000000-0000-4000-8000-000000000002');
const workerId = parseEntityId<WorkerId>('00000000-0000-4000-8000-000000000003');
const deviceId = parseEntityId<DeviceId>('00000000-0000-4000-8000-000000000004');
const conversationId = '00000000-0000-4000-8000-000000000005';
const messageId = '00000000-0000-4000-8000-000000000006';
const orderId = parseEntityId<OrderId>('00000000-0000-4000-8000-000000000007');

function jwtWithFutureExpiry(): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
}

function validCookie(): string {
  return [
    `tux_ops_access=${jwtWithFutureExpiry()}`,
    'tux_ops_refresh=test-refresh-token',
    `tux_ops_shop=${shopId}`,
    `tux_ops_device=${deviceId}`,
  ].join('; ');
}

function request(input: {
  method?: string;
  body?: Readonly<Record<string, unknown>>;
  url?: string;
  origin?: string | null;
  cookie?: string | null;
} = {}): GatewayRequest {
  const headers: Record<string, string> = { host: 'ops.example' };
  const origin = input.origin === undefined ? 'https://ops.example' : input.origin;
  const cookie = input.cookie === undefined ? validCookie() : input.cookie;
  if (origin !== null) headers['origin'] = origin;
  if (cookie !== null) headers['cookie'] = cookie;
  return {
    method: input.method ?? 'POST',
    url: input.url ?? '/api/whatsapp',
    headers,
    body: input.body,
  } as unknown as GatewayRequest;
}

function responseHarness(): {
  response: GatewayResponse;
  status: () => number;
  json: () => Record<string, unknown>;
} {
  let statusCode = 200;
  let body = '';
  const response = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(value: number) {
      statusCode = value;
    },
    setHeader: vi.fn(),
    end: vi.fn((value?: string) => {
      body = value ?? '';
    }),
  } as unknown as GatewayResponse;
  return {
    response,
    status: () => statusCode,
    json: () => JSON.parse(body || '{}') as Record<string, unknown>,
  };
}

function message(
  status: WhatsAppMessageStatus = 'PENDING',
  providerMessageId: string | null = null,
): WhatsAppMessage {
  return {
    id: messageId,
    shopId,
    conversationId,
    providerMessageId,
    outboundIntentKey: 'intent-1',
    direction: 'OUTBOUND',
    kind: 'TEXT',
    text: 'أوردر حضرتك جاهز.',
    mediaRef: null,
    status,
    sentByWorkerId: workerId,
    initiatedByDeviceId: deviceId,
    initiatedAt: instant('2026-09-02T20:00:00.000Z'),
    createdAt: instant('2026-09-02T20:00:00.000Z'),
  };
}

function sendBody(overrides: Record<string, unknown> = {}): Readonly<Record<string, unknown>> {
  return {
    action: 'SEND_MESSAGE',
    businessDayId,
    workerId,
    conversationId,
    outboundIntentKey: 'intent-1',
    text: 'أوردر حضرتك جاهز.',
    ...overrides,
  };
}

function createDependencies() {
  const repository = {
    resolveCurrentOperator: vi.fn(async () => ({ businessDayId, workerId })),
    loadInbox: vi.fn(async () => ({
      conversations: [],
      messages: [],
      quickReplies: [],
      orderLinks: [],
      nextCursor: null,
    })),
    claimOutboundTextIntent: vi.fn(async () => ({
      created: true,
      recipientNormalizedPhone: '01012345678',
      message: message(),
    })),
    attachProviderMessage: vi.fn(async () => undefined),
    failOutboundIntent: vi.fn(async () => undefined),
    setConversationState: vi.fn(async () => undefined),
    linkOrderAuthorized: vi.fn(async () => undefined),
  };
  const channelResolver = {
    resolveInboundChannel: vi.fn(async () => null),
    resolveOutboundChannel: vi.fn(async () => ({
      channelId: '00000000-0000-4000-8000-000000000020',
      provider: 'META_CLOUD_API' as const,
      providerPhoneNumberId: 'provider-phone-1',
    })),
  };
  const providerGateway = {
    sendMessage: vi.fn(async () => ({ providerMessageId: 'wamid.1' })),
  };
  const factory: WhatsAppOperationsDependencyFactory = {
    createRepository: vi.fn(() => repository as unknown as WhatsAppOperationsRepository),
    createChannelResolver: vi.fn(() => channelResolver),
    createProviderGateway: vi.fn(() => providerGateway),
    now: vi.fn(() => new Date('2026-09-02T20:00:00.000Z')),
  };
  return { factory, repository, channelResolver, providerGateway };
}

async function execute(
  req: GatewayRequest,
  factory: WhatsAppOperationsDependencyFactory,
): Promise<ReturnType<typeof responseHarness>> {
  const harness = responseHarness();
  await handleWhatsAppOperations(req, harness.response, factory);
  return harness;
}

beforeEach(() => {
  vi.stubEnv('TUX_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('TUX_SUPABASE_PUBLISHABLE_KEY', 'test-publishable-key');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('handleWhatsAppOperations', () => {
  it('returns the existing 401 for a missing device session before constructing WhatsApp dependencies', async () => {
    const deps = createDependencies();
    const result = await execute(request({ cookie: null }), deps.factory);
    expect(result.status()).toBe(401);
    expect(result.json()).toMatchObject({ error: 'device_authentication_required' });
    expect(deps.factory.createRepository).not.toHaveBeenCalled();
    expect(deps.factory.createChannelResolver).not.toHaveBeenCalled();
    expect(deps.factory.createProviderGateway).not.toHaveBeenCalled();
  });

  it('rejects a disallowed POST Origin before any WhatsApp mutation', async () => {
    const deps = createDependencies();
    const result = await execute(request({ body: sendBody(), origin: 'https://evil.example' }), deps.factory);
    expect(result.status()).toBe(403);
    expect(result.json()).toMatchObject({ error: 'origin_not_allowed' });
    expect(deps.factory.createRepository).not.toHaveBeenCalled();
  });

  it.each(['shopId', 'deviceId', 'sentByWorkerId', 'to', 'providerPhoneNumberId'])(
    'rejects renderer authority field %s',
    async (field) => {
      const deps = createDependencies();
      const result = await execute(request({ body: sendBody({ [field]: 'forbidden' }) }), deps.factory);
      expect(result.status()).toBe(400);
      expect(result.json()).toMatchObject({ error: 'invalid_whatsapp_request' });
      expect(deps.repository.resolveCurrentOperator).not.toHaveBeenCalled();
      expect(deps.providerGateway.sendMessage).not.toHaveBeenCalled();
    },
  );

  it('rejects malformed SEND_MESSAGE claims and payload before business mutation', async () => {
    const deps = createDependencies();
    const result = await execute(
      request({ body: { action: 'SEND_MESSAGE', businessDayId, workerId, conversationId } }),
      deps.factory,
    );
    expect(result.status()).toBe(400);
    expect(result.json()).toMatchObject({ error: 'invalid_whatsapp_request' });
    expect(deps.repository.resolveCurrentOperator).not.toHaveBeenCalled();
  });

  it('returns operator-not-synchronized when preflight authority is absent without resolving a channel', async () => {
    const deps = createDependencies();
    deps.repository.resolveCurrentOperator.mockResolvedValueOnce(null);
    const result = await execute(request({ body: sendBody() }), deps.factory);
    expect(result.status()).toBe(409);
    expect(result.json()).toMatchObject({ error: 'whatsapp_operator_not_synchronized' });
    expect(deps.channelResolver.resolveOutboundChannel).not.toHaveBeenCalled();
    expect(deps.repository.claimOutboundTextIntent).not.toHaveBeenCalled();
    expect(deps.providerGateway.sendMessage).not.toHaveBeenCalled();
  });

  it('returns channel-not-configured before durable claim or Meta when the authenticated shop has no channel', async () => {
    const deps = createDependencies();
    deps.channelResolver.resolveOutboundChannel.mockResolvedValueOnce(null);
    const result = await execute(request({ body: sendBody() }), deps.factory);
    expect(result.status()).toBe(503);
    expect(result.json()).toMatchObject({ error: 'whatsapp_channel_not_configured' });
    expect(deps.repository.claimOutboundTextIntent).not.toHaveBeenCalled();
    expect(deps.providerGateway.sendMessage).not.toHaveBeenCalled();
  });

  it('rejects a worker-switch/End-Day race when the atomic claim recheck loses Current Operator authority', async () => {
    const deps = createDependencies();
    deps.repository.claimOutboundTextIntent.mockRejectedValueOnce(
      new WhatsAppOperationsRepositoryError(
        'OPERATOR_NOT_SYNCHRONIZED',
        'WhatsApp Current Operator is not synchronized.',
      ),
    );
    const result = await execute(request({ body: sendBody() }), deps.factory);
    expect(deps.repository.resolveCurrentOperator).toHaveBeenCalledTimes(1);
    expect(result.status()).toBe(409);
    expect(result.json()).toMatchObject({ error: 'whatsapp_operator_not_synchronized' });
    expect(deps.providerGateway.sendMessage).not.toHaveBeenCalled();
  });

  it('sends a newly claimed intent exactly once using channel routing and the trusted conversation recipient', async () => {
    const deps = createDependencies();
    const result = await execute(request({ body: sendBody() }), deps.factory);

    expect(deps.channelResolver.resolveOutboundChannel).toHaveBeenCalledWith({ shopId });
    expect(deps.repository.claimOutboundTextIntent).toHaveBeenCalledWith({
      shopId,
      businessDayId,
      workerId,
      deviceId,
      conversationId,
      outboundIntentKey: 'intent-1',
      text: 'أوردر حضرتك جاهز.',
      initiatedAt: '2026-09-02T20:00:00.000Z',
    });
    expect(deps.providerGateway.sendMessage).toHaveBeenCalledTimes(1);
    expect(deps.providerGateway.sendMessage).toHaveBeenCalledWith({
      providerPhoneNumberId: 'provider-phone-1',
      to: '01012345678',
      kind: 'TEXT',
      text: 'أوردر حضرتك جاهز.',
    });
    expect(deps.repository.attachProviderMessage).toHaveBeenCalledWith({
      shopId,
      messageId,
      providerMessageId: 'wamid.1',
    });
    expect(result.status()).toBe(200);
    expect(result.json()).toMatchObject({
      message: { id: messageId, providerMessageId: 'wamid.1', status: 'SENT' },
    });
  });

  it.each(['SENT', 'DELIVERED', 'READ', 'FAILED'] as const)(
    'returns an existing %s intent without another Meta call',
    async (status) => {
      const deps = createDependencies();
      deps.repository.claimOutboundTextIntent.mockResolvedValueOnce({
        created: false,
        recipientNormalizedPhone: '01012345678',
        message: message(status, status === 'FAILED' ? null : 'wamid.existing'),
      });
      const result = await execute(request({ body: sendBody() }), deps.factory);
      expect(result.status()).toBe(200);
      expect(result.json()).toMatchObject({ message: { id: messageId, status } });
      expect(deps.factory.createProviderGateway).not.toHaveBeenCalled();
      expect(deps.providerGateway.sendMessage).not.toHaveBeenCalled();
    },
  );

  it('returns durable uncertainty for an existing PENDING intent with no provider id and never calls Meta', async () => {
    const deps = createDependencies();
    deps.repository.claimOutboundTextIntent.mockResolvedValueOnce({
      created: false,
      recipientNormalizedPhone: '01012345678',
      message: message('PENDING', null),
    });
    const result = await execute(request({ body: sendBody() }), deps.factory);
    expect(result.status()).toBe(503);
    expect(result.json()).toEqual({ error: 'whatsapp_delivery_uncertain', messageId });
    expect(deps.factory.createProviderGateway).not.toHaveBeenCalled();
  });

  it('maps conflicting durable intent reuse to 409 without Meta', async () => {
    const deps = createDependencies();
    deps.repository.claimOutboundTextIntent.mockRejectedValueOnce(
      new WhatsAppOperationsRepositoryError(
        'OUTBOUND_INTENT_CONFLICT',
        'WhatsApp outbound intent conflicts with an existing durable intent.',
      ),
    );
    const result = await execute(request({ body: sendBody() }), deps.factory);
    expect(result.status()).toBe(409);
    expect(result.json()).toMatchObject({ error: 'whatsapp_outbound_intent_conflict' });
    expect(deps.providerGateway.sendMessage).not.toHaveBeenCalled();
  });

  it('marks a newly-created intent FAILED only for an explicit Meta HTTP rejection', async () => {
    const deps = createDependencies();
    deps.providerGateway.sendMessage.mockRejectedValueOnce(
      new WhatsAppProviderError(400, 131026, 'WhatsApp provider rejected the request.'),
    );
    const result = await execute(request({ body: sendBody() }), deps.factory);
    expect(deps.repository.failOutboundIntent).toHaveBeenCalledWith({
      shopId,
      messageId,
      failureCode: '131026',
      failureMessage: 'WhatsApp provider rejected the request.',
    });
    expect(result.status()).toBe(502);
    expect(result.json()).toEqual({ error: 'whatsapp_provider_rejected', messageId });
  });

  it('keeps PENDING uncertainty for transport/no-HTTP failures and does not mark FAILED', async () => {
    const deps = createDependencies();
    deps.providerGateway.sendMessage.mockRejectedValueOnce(
      new WhatsAppProviderError(null, null, 'WhatsApp provider is unavailable.'),
    );
    const result = await execute(request({ body: sendBody() }), deps.factory);
    expect(result.status()).toBe(503);
    expect(result.json()).toEqual({ error: 'whatsapp_delivery_uncertain', messageId });
    expect(deps.repository.failOutboundIntent).not.toHaveBeenCalled();
  });

  it('keeps PENDING uncertainty for a generic provider transport exception', async () => {
    const deps = createDependencies();
    deps.providerGateway.sendMessage.mockRejectedValueOnce(new Error('socket reset'));
    const result = await execute(request({ body: sendBody() }), deps.factory);
    expect(result.status()).toBe(503);
    expect(result.json()).toEqual({ error: 'whatsapp_delivery_uncertain', messageId });
    expect(deps.repository.failOutboundIntent).not.toHaveBeenCalled();
  });

  it('treats provider success followed by provider-id persistence failure as uncertain without an in-request resend', async () => {
    const deps = createDependencies();
    deps.repository.attachProviderMessage.mockRejectedValueOnce(new Error('persist unavailable'));
    const result = await execute(request({ body: sendBody() }), deps.factory);
    expect(result.status()).toBe(503);
    expect(result.json()).toEqual({ error: 'whatsapp_delivery_uncertain', messageId });
    expect(deps.providerGateway.sendMessage).toHaveBeenCalledTimes(1);
    expect(deps.repository.failOutboundIntent).not.toHaveBeenCalled();
  });

  it('does not resend on retry after provider success but provider-id persistence failure', async () => {
    const deps = createDependencies();
    deps.repository.claimOutboundTextIntent
      .mockResolvedValueOnce({
        created: true,
        recipientNormalizedPhone: '01012345678',
        message: message('PENDING', null),
      })
      .mockResolvedValueOnce({
        created: false,
        recipientNormalizedPhone: '01012345678',
        message: message('PENDING', null),
      });
    deps.repository.attachProviderMessage.mockRejectedValueOnce(new Error('persist unavailable'));

    const first = await execute(request({ body: sendBody() }), deps.factory);
    const second = await execute(request({ body: sendBody() }), deps.factory);
    expect(first.status()).toBe(503);
    expect(second.status()).toBe(503);
    expect(first.json()).toEqual({ error: 'whatsapp_delivery_uncertain', messageId });
    expect(second.json()).toEqual({ error: 'whatsapp_delivery_uncertain', messageId });
    expect(deps.providerGateway.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('GET inbox constructs only data-plane repository dependencies and never the provider gateway', async () => {
    const deps = createDependencies();
    const result = await execute(
      request({ method: 'GET', url: '/api/whatsapp?after=2026-09-02T20%3A00%3A00.000Z', origin: null }),
      deps.factory,
    );
    expect(result.status()).toBe(200);
    expect(deps.repository.loadInbox).toHaveBeenCalledWith({
      shopId,
      after: '2026-09-02T20:00:00.000Z',
    });
    expect(deps.factory.createChannelResolver).not.toHaveBeenCalled();
    expect(deps.factory.createProviderGateway).not.toHaveBeenCalled();
  });

  it.each([
    [
      'MARK_UNREAD',
      { action: 'MARK_UNREAD', conversationId },
      { shopId, conversationId, archived: null, followUp: null, markUnread: true },
    ],
    [
      'ARCHIVE',
      { action: 'ARCHIVE', conversationId, archived: true },
      { shopId, conversationId, archived: true, followUp: null, markUnread: false },
    ],
    [
      'FOLLOW_UP',
      { action: 'FOLLOW_UP', conversationId, followUp: true },
      { shopId, conversationId, archived: null, followUp: true, markUnread: false },
    ],
  ] as const)(
    '%s uses only the authenticated session shop and data-plane state mutation',
    async (_name, body, expected) => {
      const deps = createDependencies();
      const result = await execute(request({ body }), deps.factory);
      expect(result.status()).toBe(200);
      expect(deps.repository.setConversationState).toHaveBeenCalledWith(expected);
      expect(deps.factory.createChannelResolver).not.toHaveBeenCalled();
      expect(deps.factory.createProviderGateway).not.toHaveBeenCalled();
    },
  );

  it('LINK_ORDER sends Current Operator claims to the authorized wrapper with authenticated shop/device only', async () => {
    const deps = createDependencies();
    const result = await execute(
      request({
        body: {
          action: 'LINK_ORDER',
          businessDayId,
          workerId,
          conversationId,
          orderId,
          linked: true,
        },
      }),
      deps.factory,
    );
    expect(result.status()).toBe(200);
    expect(deps.repository.linkOrderAuthorized).toHaveBeenCalledWith({
      shopId,
      businessDayId,
      workerId,
      deviceId,
      conversationId,
      orderId,
      linked: true,
    });
    expect(deps.repository.resolveCurrentOperator).not.toHaveBeenCalled();
    expect(deps.factory.createChannelResolver).not.toHaveBeenCalled();
    expect(deps.factory.createProviderGateway).not.toHaveBeenCalled();
  });
});
