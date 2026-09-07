import { describe, expect, it, vi } from 'vitest';
import { DesktopWhatsAppRemote } from './desktopWhatsAppRemote';

const deviceId = '22222222-2222-4222-8222-222222222222';
const conversationId = '55555555-5555-4555-8555-555555555555';
const messageId = '66666666-6666-4666-8666-666666666666';

function sessionManager() {
  return {
    resolveSession: vi.fn().mockResolvedValue({
      status: 'VALID' as const,
      session: {
        shopId: '11111111-1111-4111-8111-111111111111',
        deviceId,
        accessToken: 'short-lived-access',
        refreshToken: 'must-never-be-transmitted',
        expiresAt: 2_000_000_000,
      },
    }),
  };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function envelope() {
  return {
    cursor: 'cursor-2',
    messages: [
      {
        messageId,
        conversationId,
        createdAt: '2026-09-05T20:30:00.000Z',
        kind: 'TEXT',
        preview: 'Safe preview',
        customerName: 'Ahmed',
      },
    ],
  };
}

describe('DesktopWhatsAppRemote Task 9E notification transport', () => {
  it('loads the minimal notification feed with bearer and device authentication', async () => {
    const manager = sessionManager();
    const fetcher = vi.fn().mockResolvedValue(json(envelope()));
    const remote = new DesktopWhatsAppRemote({
      apiOrigin: 'https://ops.example',
      sessionManager: manager as never,
      fetcher,
    });

    await expect(remote.loadNotificationFeed('cursor-1')).resolves.toEqual(envelope());

    expect(manager.resolveSession).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [target, init] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(String(target)).toBe(
      'https://ops.example/api/whatsapp?feed=notifications&after=cursor-1',
    );
    expect(init).toMatchObject({
      method: 'GET',
      headers: {
        Authorization: 'Bearer short-lived-access',
        'x-tux-device-id': deviceId,
        Accept: 'application/json',
      },
    });
  });

  it('rejects fields outside the minimal notification privacy envelope', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      json({
        ...envelope(),
        messages: [
          {
            ...envelope().messages[0],
            providerMessageId: 'wamid.must-not-cross-electron-boundary',
          },
        ],
      }),
    );
    const remote = new DesktopWhatsAppRemote({
      apiOrigin: 'https://ops.example',
      sessionManager: sessionManager() as never,
      fetcher,
    });

    await expect(remote.loadNotificationFeed(null)).rejects.toBeInstanceOf(TypeError);
  });
});
