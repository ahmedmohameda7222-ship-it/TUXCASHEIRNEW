import { WhatsAppRemoteError } from '@tux/application';
import { parseEntityId, type BusinessDayId, type WorkerId } from '@tux/domain';
import { describe, expect, it, vi } from 'vitest';
import { DesktopWhatsAppRemote, parseTuxOperationsApiOrigin } from './desktopWhatsAppRemote';

const deviceId = '22222222-2222-4222-8222-222222222222';
const businessDayId = parseEntityId<BusinessDayId>('33333333-3333-4333-8333-333333333333');
const workerId = parseEntityId<WorkerId>('44444444-4444-4444-8444-444444444444');
const conversationId = '55555555-5555-4555-8555-555555555555';
const messageId = '66666666-6666-4666-8666-666666666666';

function validResolution() {
  return {
    status: 'VALID' as const,
    session: {
      shopId: '11111111-1111-4111-8111-111111111111',
      deviceId,
      accessToken: 'short-lived-access',
      refreshToken: 'must-never-be-transmitted',
      expiresAt: 2_000_000_000,
    },
  };
}

function sessionManager(resolution: unknown = validResolution()) {
  return { resolveSession: vi.fn().mockResolvedValue(resolution) };
}

function inboxResponse(): Response {
  return new Response(
    JSON.stringify({
      conversations: [],
      messages: [],
      quickReplies: [],
      orderLinks: [],
      nextCursor: null,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function outboundMessage() {
  return {
    id: messageId,
    shopId: '11111111-1111-4111-8111-111111111111',
    conversationId,
    providerMessageId: 'wamid.1',
    outboundIntentKey: 'intent-1',
    direction: 'OUTBOUND',
    kind: 'TEXT',
    text: 'hello',
    mediaRef: null,
    status: 'SENT',
    sentByWorkerId: workerId,
    initiatedByDeviceId: deviceId,
    initiatedAt: '2026-09-03T12:00:00.000Z',
    createdAt: '2026-09-03T12:00:00.000Z',
  };
}

describe('parseTuxOperationsApiOrigin', () => {
  it.each(['https://ops.example', 'https://ops.example/'])('accepts HTTPS origin %s', (value) =>
    expect(parseTuxOperationsApiOrigin(value)).toBe('https://ops.example'),
  );

  it.each([
    'http://ops.example',
    'https://ops.example/api',
    'https://ops.example?x=1',
    'https://ops.example#fragment',
    'https://user:pass@ops.example',
  ])('rejects non-origin or insecure value %s', (value) => {
    expect(() => parseTuxOperationsApiOrigin(value)).toThrow();
  });
});

describe('DesktopWhatsAppRemote', () => {
  it('captures a GET using only bearer, device and Accept headers', async () => {
    const manager = sessionManager();
    const fetcher = vi.fn().mockResolvedValue(inboxResponse());
    const remote = new DesktopWhatsAppRemote({
      apiOrigin: 'https://ops.example',
      sessionManager: manager as never,
      fetcher,
    });

    await remote.loadInbox('cursor one');

    expect(manager.resolveSession).toHaveBeenCalledTimes(1);
    const [target, init] = fetcher.mock.calls[0] ?? [];
    expect(String(target)).toBe('https://ops.example/api/whatsapp?after=cursor+one');
    expect(init).toEqual({
      method: 'GET',
      headers: {
        Authorization: 'Bearer short-lived-access',
        'x-tux-device-id': deviceId,
        Accept: 'application/json',
      },
    });
    const transmitted = JSON.stringify([target, init]).toLowerCase();
    for (const forbidden of [
      'apikey',
      'shopid',
      'refreshtoken',
      'providerphonenumberid',
      'service_role',
      'graph.facebook.com',
    ]) {
      expect(transmitted).not.toContain(forbidden);
    }
  });

  it('captures representative POST without tenant or secret authority fields', async () => {
    const manager = sessionManager();
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: outboundMessage() }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const remote = new DesktopWhatsAppRemote({
      apiOrigin: 'https://ops.example',
      sessionManager: manager as never,
      fetcher,
    });

    await remote.sendText({
      businessDayId,
      workerId,
      conversationId,
      outboundIntentKey: 'intent-1',
      text: 'hello',
    });

    const [target, init] = fetcher.mock.calls[0] ?? [];
    expect(String(target)).toBe('https://ops.example/api/whatsapp');
    expect(init).toEqual(
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer short-lived-access',
          'x-tux-device-id': deviceId,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      }),
    );
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toEqual({
      action: 'SEND_MESSAGE',
      businessDayId,
      workerId,
      conversationId,
      outboundIntentKey: 'intent-1',
      text: 'hello',
    });
    const transmitted = JSON.stringify([target, init]).toLowerCase();
    for (const forbidden of [
      'apikey',
      'shopid',
      'deviceid',
      'sentbyworkerid',
      'providerphonenumberid',
      'refreshtoken',
      'service_role',
      'meta access',
      'meta app',
      'webhook verify',
      'graph.facebook.com',
    ]) {
      expect(transmitted).not.toContain(forbidden);
    }
  });

  it('resolves the device session separately for every request', async () => {
    const manager = sessionManager();
    const fetcher = vi.fn().mockImplementation(async () => inboxResponse());
    const remote = new DesktopWhatsAppRemote({
      apiOrigin: 'https://ops.example',
      sessionManager: manager as never,
      fetcher,
    });
    await remote.loadInbox();
    await remote.loadInbox();
    expect(manager.resolveSession).toHaveBeenCalledTimes(2);
  });

  it('maps TRANSPORT_UNAVAILABLE to REMOTE_UNAVAILABLE', async () => {
    const remote = new DesktopWhatsAppRemote({
      apiOrigin: 'https://ops.example',
      sessionManager: sessionManager({
        status: 'TRANSPORT_UNAVAILABLE',
        message: 'offline',
      }) as never,
      fetcher: vi.fn(),
    });
    await expect(remote.loadInbox()).rejects.toMatchObject({ code: 'REMOTE_UNAVAILABLE' });
  });

  it.each(['NOT_ENROLLED', 'AUTHORITATIVELY_INVALID'] as const)(
    'maps %s to DEVICE_AUTH_INVALID',
    async (status) => {
      const remote = new DesktopWhatsAppRemote({
        apiOrigin: 'https://ops.example',
        sessionManager: sessionManager({ status, message: 'invalid' }) as never,
        fetcher: vi.fn(),
      });
      await expect(remote.loadInbox()).rejects.toMatchObject({ code: 'DEVICE_AUTH_INVALID' });
    },
  );

  it.each(['PROTOCOL_ERROR', 'LOCAL_PERSISTENCE_ERROR'] as const)(
    'fails closed for session %s rather than classifying cached-offline availability',
    async (status) => {
      const resolution =
        status === 'LOCAL_PERSISTENCE_ERROR'
          ? { status, message: 'local failure', cause: new Error('secret local detail') }
          : { status, message: 'protocol failure' };
      const remote = new DesktopWhatsAppRemote({
        apiOrigin: 'https://ops.example',
        sessionManager: sessionManager(resolution) as never,
        fetcher: vi.fn(),
      });
      try {
        await remote.loadInbox();
        throw new Error('expected rejection');
      } catch (error) {
        expect(error).not.toBeInstanceOf(WhatsAppRemoteError);
      }
    },
  );

  it('maps request transport failure to REMOTE_UNAVAILABLE', async () => {
    const remote = new DesktopWhatsAppRemote({
      apiOrigin: 'https://ops.example',
      sessionManager: sessionManager() as never,
      fetcher: vi.fn().mockRejectedValue(new Error('network down')),
    });
    await expect(remote.loadInbox()).rejects.toMatchObject({ code: 'REMOTE_UNAVAILABLE' });
  });

  it('does not retry DELIVERY_UNCERTAIN', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'whatsapp_delivery_uncertain', messageId }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const remote = new DesktopWhatsAppRemote({
      apiOrigin: 'https://ops.example',
      sessionManager: sessionManager() as never,
      fetcher,
    });
    await expect(
      remote.sendText({
        businessDayId,
        workerId,
        conversationId,
        outboundIntentKey: 'intent-1',
        text: 'hello',
      }),
    ).rejects.toMatchObject({ code: 'DELIVERY_UNCERTAIN', messageId });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
