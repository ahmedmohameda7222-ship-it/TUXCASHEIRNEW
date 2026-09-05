import {
  parseEntityId,
  type DeviceId,
  type ShopId,
  type WhatsAppMessage,
} from '@tux/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WhatsAppInboxSnapshot } from '@tux/application';
import type { GatewayRequest, GatewayResponse } from './supabaseGateway';
import {
  handleWhatsAppOperations,
  type WhatsAppOperationsDependencyFactory,
} from './whatsappOperationsGateway';

const shopId = parseEntityId<ShopId>('10000000-0000-4000-8000-000000000001');
const deviceId = parseEntityId<DeviceId>('40000000-0000-4000-8000-000000000001');
const conversationId = '50000000-0000-4000-8000-000000000001';
const textMessageId = '60000000-0000-4000-8000-000000000001';
const imageMessageId = '60000000-0000-4000-8000-000000000002';

function request(after: string | null = null): GatewayRequest {
  const url = new URL('/api/whatsapp', 'https://ops.example');
  url.searchParams.set('feed', 'notifications');
  if (after !== null) url.searchParams.set('after', after);
  return {
    method: 'GET',
    url: `${url.pathname}${url.search}`,
    headers: {
      authorization: 'Bearer test-device-token',
      'x-tux-device-id': deviceId,
    },
  } as unknown as GatewayRequest;
}

function responseHarness() {
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
    raw: () => body,
  };
}

function inboundMessage(input: {
  readonly id: string;
  readonly kind: 'TEXT' | 'IMAGE';
  readonly text: string | null;
}): WhatsAppMessage {
  return {
    id: input.id,
    shopId,
    conversationId,
    providerMessageId: `wamid.secret.${input.id}`,
    outboundIntentKey: null,
    direction: 'INBOUND',
    kind: input.kind,
    text: input.text,
    mediaRef: input.kind === 'IMAGE' ? 'SECRET_MEDIA_KEY' : null,
    media:
      input.kind === 'IMAGE'
        ? {
            mediaKey: 'SECRET_MEDIA_KEY',
            kind: 'IMAGE',
            mimeType: 'image/jpeg',
            fileName: 'SECRET_FILE_NAME.jpg',
            byteSize: 4,
            storedAt: '2026-09-05T20:00:00.000Z',
            expiresAt: '2026-10-05T20:00:00.000Z',
            availability: 'AVAILABLE',
          }
        : null,
    location: null,
    status: 'DELIVERED',
    sentByWorkerId: null,
    initiatedByDeviceId: null,
    initiatedAt: null,
    createdAt: '2026-09-05T20:30:00.000Z',
  } as WhatsAppMessage;
}

function snapshot(): WhatsAppInboxSnapshot {
  return {
    conversations: [
      {
        id: conversationId,
        shopId,
        normalizedPhone: '01012345678',
        displayPhone: '+201012345678',
        customerName: 'SECRET CUSTOMER',
        context: 'DIRECT',
        linkedOrderId: null,
        unreadCount: 2,
        archived: false,
        followUp: false,
        lastMessageAt: '2026-09-05T20:30:00.000Z',
      },
    ],
    messages: [
      inboundMessage({ id: textMessageId, kind: 'TEXT', text: 'SECRET TEXT PREVIEW' }),
      inboundMessage({ id: imageMessageId, kind: 'IMAGE', text: 'SECRET IMAGE CAPTION' }),
    ],
    quickReplies: [],
    orderLinks: [],
    nextCursor: 'cursor-2',
  } as WhatsAppInboxSnapshot;
}

function dependencies(previewAllowed: boolean): WhatsAppOperationsDependencyFactory {
  const repository = {
    loadInbox: vi.fn(async () => snapshot()),
    hasActiveNotificationOperator: vi.fn(async () => previewAllowed),
  };
  return {
    createRepository: vi.fn(() => repository),
    createChannelResolver: vi.fn(),
    createProviderGateway: vi.fn(),
    createMediaStorage: vi.fn(),
    resolveDeviceAuthority: vi.fn(async () => ({ shopId, deviceId })),
    now: vi.fn(() => new Date('2026-09-05T20:31:00.000Z')),
  } as unknown as WhatsAppOperationsDependencyFactory;
}

async function execute(factory: WhatsAppOperationsDependencyFactory) {
  const harness = responseHarness();
  await handleWhatsAppOperations(request('cursor-1'), harness.response, factory);
  return harness;
}

beforeEach(() => {
  vi.stubEnv('TUX_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('TUX_SUPABASE_PUBLISHABLE_KEY', 'test-publishable-key');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Task 9E notification envelope privacy fence', () => {
  it(
    'returns generic-only metadata when no ACTIVE current operator is server-authorized',
    async () => {
      const result = await execute(dependencies(false));

      expect(result.status()).toBe(200);
      expect(result.json()).toEqual({
        cursor: 'cursor-2',
        messages: [
          {
            messageId: textMessageId,
            conversationId,
            createdAt: '2026-09-05T20:30:00.000Z',
            kind: 'TEXT',
            preview: null,
            customerName: null,
          },
          {
            messageId: imageMessageId,
            conversationId,
            createdAt: '2026-09-05T20:30:00.000Z',
            kind: 'IMAGE',
            preview: null,
            customerName: null,
          },
        ],
      });
      for (const secret of [
        'SECRET CUSTOMER',
        'SECRET TEXT PREVIEW',
        'SECRET IMAGE CAPTION',
        '01012345678',
        '+201012345678',
        'SECRET_FILE_NAME.jpg',
        'SECRET_MEDIA_KEY',
        'wamid.secret',
      ]) {
        expect(result.raw()).not.toContain(secret);
      }
    },
  );

  it(
    'allows only safe text/customer preview after server ACTIVE-operator authorization',
    async () => {
      const result = await execute(dependencies(true));
      const payload = result.json();

      expect(payload).toEqual({
        cursor: 'cursor-2',
        messages: [
          {
            messageId: textMessageId,
            conversationId,
            createdAt: '2026-09-05T20:30:00.000Z',
            kind: 'TEXT',
            preview: 'SECRET TEXT PREVIEW',
            customerName: 'SECRET CUSTOMER',
          },
          {
            messageId: imageMessageId,
            conversationId,
            createdAt: '2026-09-05T20:30:00.000Z',
            kind: 'IMAGE',
            preview: null,
            customerName: 'SECRET CUSTOMER',
          },
        ],
      });
      expect(result.raw()).not.toContain('SECRET IMAGE CAPTION');
      expect(result.raw()).not.toContain('SECRET_FILE_NAME.jpg');
      expect(result.raw()).not.toContain('SECRET_MEDIA_KEY');
      expect(result.raw()).not.toContain('wamid.secret');
    },
  );
});
