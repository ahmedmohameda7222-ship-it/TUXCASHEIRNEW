import { parseEntityId, type ShopId } from '@tux/domain';
import { describe, expect, it, vi } from 'vitest';
import { SupabaseWhatsAppOperationsRepository } from './whatsappOperationsRepository';

const shopId = parseEntityId<ShopId>('00000000-0000-4000-8000-000000000001');
const conversationId = '00000000-0000-4000-8000-000000000002';
const imageMessageId = '00000000-0000-4000-8000-000000000003';
const locationMessageId = '00000000-0000-4000-8000-000000000004';
const inboxV2Url = 'https://example.supabase.co/rest/v1/rpc/get_tux_whatsapp_inbox_v2';
const materializeInboundV2Url =
  'https://example.supabase.co/rest/v1/rpc/materialize_tux_whatsapp_inbound_v2';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function repository(fetchMock: ReturnType<typeof vi.fn>) {
  return new SupabaseWhatsAppOperationsRepository(
    {
      projectUrl: 'https://example.supabase.co',
      serviceRoleKey: 'server-only-service-role-key',
    },
    fetchMock as unknown as typeof fetch,
  );
}

function inboxPayload(): Record<string, unknown> {
  return {
    conversations: [
      {
        id: conversationId,
        shop_id: shopId,
        normalized_phone: '01012345678',
        display_phone: '+201012345678',
        customer_name: 'Ahmed',
        context: 'DIRECT',
        unread_count: 2,
        archived: false,
        follow_up: false,
        last_message_at: '2026-09-04T12:01:00.000Z',
      },
    ],
    messages: [
      {
        id: imageMessageId,
        shop_id: shopId,
        conversation_id: conversationId,
        provider_message_id: 'wamid.message.image',
        outbound_intent_key: null,
        direction: 'INBOUND',
        kind: 'IMAGE',
        text: null,
        media_ref: 'tux-media-image-1',
        media: {
          mediaKey: 'tux-media-image-1',
          kind: 'IMAGE',
          mimeType: 'image/png',
          fileName: 'photo.png',
          byteSize: 256,
          storedAt: '2026-09-04T12:00:00.000Z',
          expiresAt: '2026-10-04T12:00:00.000Z',
          availability: 'AVAILABLE',
          providerMediaId: 'meta-media-must-not-escape',
          objectPath: 'media/shop/private-object',
          signedUrl: 'https://example.supabase.co/storage/v1/object/sign/private?token=secret',
        },
        location: null,
        status: 'DELIVERED',
        sent_by_worker_id: null,
        initiated_by_device_id: null,
        initiated_at: null,
        created_at: '2026-09-04T12:00:01.000Z',
        updated_at: '2026-09-04T12:00:02.000Z',
        provider_media_id: 'meta-media-top-level-must-not-escape',
        bucket_id: 'tux-whatsapp-media',
        object_path: 'media/shop/private-object',
        provider_download_url: 'https://lookaside.fbsbx.com/private-provider-download',
        signed_access_url:
          'https://example.supabase.co/storage/v1/object/sign/private?token=top-secret',
        service_role_key: 'server-only-service-role-key',
      },
      {
        id: locationMessageId,
        shop_id: shopId,
        conversation_id: conversationId,
        provider_message_id: 'wamid.message.location',
        outbound_intent_key: null,
        direction: 'INBOUND',
        kind: 'LOCATION',
        text: null,
        media_ref: null,
        media: null,
        location: {
          latitude: 30.0444,
          longitude: 31.2357,
          name: 'TUX Store',
          address: 'Cairo',
          providerDownloadUrl: 'https://lookaside.fbsbx.com/must-not-escape',
        },
        status: 'DELIVERED',
        sent_by_worker_id: null,
        initiated_by_device_id: null,
        initiated_at: null,
        created_at: '2026-09-04T12:01:00.000Z',
        updated_at: '2026-09-04T12:01:01.000Z',
      },
    ],
    quickReplies: [],
    orderLinks: [],
  };
}

describe('SupabaseWhatsAppOperationsRepository inbox v2', () => {
  it('parses only safe media and structured location fields', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      void url;
      void init;
      return jsonResponse(inboxPayload());
    });
    const snapshot = await repository(fetchMock).loadInbox({
      shopId,
      after: '2026-09-04T11:59:00.000Z',
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const rpcBody = JSON.parse(String(init?.body));
    expect(String(url)).toBe(inboxV2Url);
    expect(rpcBody).toEqual({
      p_shop_id: shopId,
      p_cursor: '2026-09-04T11:59:00.000Z',
    });

    expect(snapshot.messages).toHaveLength(2);
    expect(snapshot.messages[0]).toMatchObject({
      id: imageMessageId,
      kind: 'IMAGE',
      mediaRef: 'tux-media-image-1',
      media: {
        mediaKey: 'tux-media-image-1',
        kind: 'IMAGE',
        mimeType: 'image/png',
        fileName: 'photo.png',
        byteSize: 256,
        storedAt: '2026-09-04T12:00:00.000Z',
        expiresAt: '2026-10-04T12:00:00.000Z',
        availability: 'AVAILABLE',
      },
      location: null,
    });
    expect(snapshot.messages[1]).toMatchObject({
      id: locationMessageId,
      kind: 'LOCATION',
      mediaRef: null,
      media: null,
      location: {
        latitude: 30.0444,
        longitude: 31.2357,
        name: 'TUX Store',
        address: 'Cairo',
      },
    });

    const serialized = JSON.stringify(snapshot);
    for (const forbidden of [
      'meta-media-must-not-escape',
      'meta-media-top-level-must-not-escape',
      'media/shop/private-object',
      'lookaside.fbsbx.com',
      'token=secret',
      'token=top-secret',
      'server-only-service-role-key',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('materializes inbound media through the server-only v2 RPC contract', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(materializeInboundV2Url);
      const headers = new Headers(init?.headers);
      expect(headers.get('apikey')).toBe('server-only-service-role-key');
      expect(headers.get('authorization')).toBe('Bearer server-only-service-role-key');
      expect(JSON.parse(String(init?.body))).toEqual({
        p_shop_id: shopId,
        p_provider_message_id: 'wamid.inbound.media',
        p_normalized_phone: '01012345678',
        p_display_phone: '+201012345678',
        p_kind: 'IMAGE',
        p_provider_media_id: 'meta-private-media-id',
        p_media_key: 'tux-media-image-1',
        p_bucket_id: 'tux-whatsapp-media',
        p_object_path: `media/${shopId}/tux-media-image-1`,
        p_mime_type: 'image/jpeg',
        p_file_name: 'photo.jpg',
        p_byte_size: 4,
        p_sha256: 'canonical-sha256',
        p_stored_at: '2026-09-04T12:00:00.000Z',
        p_expires_at: '2026-10-04T12:00:00.000Z',
        p_provider_occurred_at: '2026-09-04T11:59:59.000Z',
      });
      return jsonResponse([
        {
          message_id: imageMessageId,
          media_key: 'tux-media-image-1',
          created: true,
        },
      ]);
    });

    const result = await repository(fetchMock).materializeInboundMedia({
      shopId,
      providerMessageId: 'wamid.inbound.media',
      normalizedPhone: '01012345678',
      displayPhone: '+201012345678',
      kind: 'IMAGE',
      providerMediaId: 'meta-private-media-id',
      mediaKey: 'tux-media-image-1',
      bucketId: 'tux-whatsapp-media',
      objectPath: `media/${shopId}/tux-media-image-1`,
      mimeType: 'image/jpeg',
      fileName: 'photo.jpg',
      byteSize: 4,
      sha256: 'canonical-sha256',
      storedAt: '2026-09-04T12:00:00.000Z',
      expiresAt: '2026-10-04T12:00:00.000Z',
      providerOccurredAt: '2026-09-04T11:59:59.000Z',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      messageId: imageMessageId,
      mediaKey: 'tux-media-image-1',
      created: true,
    });
    expect(JSON.stringify(result)).not.toContain('meta-private-media-id');
    expect(JSON.stringify(result)).not.toContain('media/');
  });
});
