import { parseEntityId, type ShopId } from '@tux/domain';
import { describe, expect, it, vi } from 'vitest';
import { SupabaseWhatsAppChannelResolver } from './whatsappChannelResolver';

const projectUrl = 'https://example.supabase.co';
const serviceRoleKey = 'server-service-role-secret';

function createResolver(fetchMock: typeof fetch) {
  return new SupabaseWhatsAppChannelResolver(
    { projectUrl, serviceRoleKey },
    fetchMock,
  );
}

describe('SupabaseWhatsAppChannelResolver', () => {
  it('resolves a known inbound provider phone identity to exactly one shop', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify([
          {
            channel_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            shop_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const resolver = createResolver(fetchMock as unknown as typeof fetch);

    const resolved = await resolver.resolveInboundChannel({
      provider: 'META_CLOUD_API',
      providerPhoneNumberId: '123456789',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `${projectUrl}/rest/v1/rpc/resolve_tux_whatsapp_inbound_channel_v1`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          p_provider: 'META_CLOUD_API',
          p_provider_phone_number_id: '123456789',
        }),
      }),
    );
    expect(resolved).toEqual({
      channelId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      shopId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
  });

  it('returns null for a successful empty inbound resolution', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const resolver = createResolver(fetchMock as unknown as typeof fetch);

    await expect(
      resolver.resolveInboundChannel({
        provider: 'META_CLOUD_API',
        providerPhoneNumberId: 'unknown',
      }),
    ).resolves.toBeNull();
  });

  it('routes outbound resolution only by the authenticated shop id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              channel_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              provider: 'META_CLOUD_API',
              provider_phone_number_id: 'phone-a',
            },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              channel_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
              provider: 'META_CLOUD_API',
              provider_phone_number_id: 'phone-b',
            },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    const resolver = createResolver(fetchMock as unknown as typeof fetch);
    const shopA = parseEntityId<ShopId>('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    const shopB = parseEntityId<ShopId>('dddddddd-dddd-4ddd-8ddd-dddddddddddd');

    await expect(resolver.resolveOutboundChannel({ shopId: shopA })).resolves.toMatchObject({
      providerPhoneNumberId: 'phone-a',
    });
    await expect(resolver.resolveOutboundChannel({ shopId: shopB })).resolves.toMatchObject({
      providerPhoneNumberId: 'phone-b',
    });

    const firstInit = fetchMock.mock.calls[0]?.[1];
    const secondInit = fetchMock.mock.calls[1]?.[1];
    expect(firstInit?.body).toBe(JSON.stringify({ p_shop_id: shopA }));
    expect(secondInit?.body).toBe(JSON.stringify({ p_shop_id: shopB }));
  });

  it('fails safely on transport/protocol errors without exposing the service credential', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: `diagnostic ${serviceRoleKey}` }), { status: 500 }),
    );
    const resolver = createResolver(fetchMock as unknown as typeof fetch);

    await expect(
      resolver.resolveInboundChannel({
        provider: 'META_CLOUD_API',
        providerPhoneNumberId: '123456789',
      }),
    ).rejects.not.toThrow(serviceRoleKey);

    const malformedFetch = vi.fn(async () =>
      new Response(JSON.stringify([{ channel_id: 'not-a-uuid', shop_id: 'not-a-uuid' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const malformedResolver = createResolver(malformedFetch as unknown as typeof fetch);
    await expect(
      malformedResolver.resolveInboundChannel({
        provider: 'META_CLOUD_API',
        providerPhoneNumberId: '123456789',
      }),
    ).rejects.toThrow('WhatsApp channel resolver returned an invalid response.');
  });
});
