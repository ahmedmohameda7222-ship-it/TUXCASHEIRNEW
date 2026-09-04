import { describe, expect, it, vi } from 'vitest';
import {
  SupabaseWhatsAppMediaStorage,
  WHATSAPP_MEDIA_BUCKET,
  WHATSAPP_MEDIA_RETENTION_MS,
} from './whatsappMediaStorage';

const config = {
  projectUrl: 'https://example.supabase.co',
  serviceRoleKey: 'service-role-secret',
};

function storage(
  fetchMock: ReturnType<typeof vi.fn>,
  now = () => Date.parse('2026-09-04T12:00:00Z'),
) {
  return new SupabaseWhatsAppMediaStorage(config, fetchMock as unknown as typeof fetch, now);
}

describe('private WhatsApp media storage', () => {
  it('uses exact server constants and deterministic server-owned object paths', () => {
    expect(WHATSAPP_MEDIA_BUCKET).toBe('tux-whatsapp-media');
    expect(WHATSAPP_MEDIA_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(SupabaseWhatsAppMediaStorage.objectPath({ shopId: 'shop-1', mediaKey: 'media-1' })).toBe(
      'media/shop-1/media-1',
    );
    expect(
      SupabaseWhatsAppMediaStorage.objectPath({ shopId: 'shop-1', mediaKey: '../../escape' }),
    ).toBeNull();
  });

  it('creates private signed upload access without using client filenames as object paths', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ url: '/storage/v1/upload/resumable/signed-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const result = await storage(fetchMock).createSignedUpload({
      shopId: 'shop-1',
      mediaKey: 'media-1',
      fileName: '../../secret.pdf',
    });
    expect(result.objectPath).toBe('quarantine/shop-1/media-1');
    expect(result.url).toContain('example.supabase.co');
    expect(result.url).not.toContain('secret.pdf');
    expect(JSON.stringify(result)).not.toContain('service-role-secret');
  });

  it('returns short-lived signed download access only for unexpired canonical objects', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ signedURL: '/storage/v1/object/sign/tux-whatsapp-media/token' }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
    );
    const result = await storage(fetchMock).createSignedDownload({
      objectPath: 'media/shop-1/media-1',
      expiresAt: '2026-10-04T12:00:00.000Z',
    });
    expect(result.status).toBe('AVAILABLE');
    if (result.status === 'AVAILABLE') {
      expect(result.urlExpiresAt).toBe('2026-09-04T12:05:00.000Z');
      expect(result.url).toContain('example.supabase.co');
    }
  });

  it('fails closed at the logical 30-day expiry without requesting a signed URL', async () => {
    const fetchMock = vi.fn();
    await expect(
      storage(fetchMock).createSignedDownload({
        objectPath: 'media/shop-1/media-1',
        expiresAt: '2026-09-04T12:00:00.000Z',
      }),
    ).resolves.toEqual({ status: 'EXPIRED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
