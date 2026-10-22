import { describe, expect, it, vi } from 'vitest';
import { WhatsAppProviderError } from './whatsappProviderGateway';
import {
  dispatchPendingWhatsAppEventMessages,
  type WhatsAppEventMessagingDependencies,
  type WhatsAppEventMessagingRepository,
} from './whatsappEventMessaging';
import { handleWhatsAppEventDispatch } from './whatsappEventDispatchHandler';

const READY = {
  intentId: '81000000-0000-4000-8000-000000000001',
  messageId: '82000000-0000-4000-8000-000000000001',
  shopId: '83000000-0000-4000-8000-000000000001',
  providerPhoneNumberId: 'provider-phone-1',
  recipientNormalizedPhone: '01012345678',
  providerTemplateName: 'order_accepted',
  languageCode: 'ar_EG',
  variables: ['Ahmed', '42', 'ACCEPTED', 'TUX Maadi', 'Maadi'],
} as const;

function repository(
  overrides: Partial<WhatsAppEventMessagingRepository> = {},
): WhatsAppEventMessagingRepository {
  let leased = false;
  return {
    leasePending: vi.fn(async () => {
      if (leased) return [];
      leased = true;
      return [{ intentId: READY.intentId, leaseToken: 'lease-token' }];
    }),
    beginProviderAttempt: vi.fn(async () => READY),
    completeProviderAttempt: vi.fn(async () => undefined),
    ...overrides,
  };
}

function dependencies(
  repo: WhatsAppEventMessagingRepository = repository(),
): WhatsAppEventMessagingDependencies {
  return {
    repository: repo,
    provider: { sendMessage: vi.fn(async () => ({ providerMessageId: 'wamid.1' })) },
    workerId: 'dispatcher-a',
    leaseToken: () => 'lease-token',
  };
}

describe('dispatchPendingWhatsAppEventMessages', () => {
  it('sends one automatic message for repeated dispatch of the same canonical event', async () => {
    const deps = dependencies();
    await dispatchPendingWhatsAppEventMessages(deps);
    await dispatchPendingWhatsAppEventMessages(deps);
    expect(deps.provider.sendMessage).toHaveBeenCalledTimes(1);
    expect(deps.repository.completeProviderAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'SENT', providerMessageId: 'wamid.1' }),
    );
  });

  it('lets two simultaneous dispatchers produce at most one provider call', async () => {
    const deps = dependencies();
    await Promise.all([
      dispatchPendingWhatsAppEventMessages(deps),
      dispatchPendingWhatsAppEventMessages(deps),
    ]);
    expect(deps.provider.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('does not blindly retry after an uncertain provider outcome', async () => {
    const repo = repository();
    const deps = dependencies(repo);
    vi.mocked(deps.provider.sendMessage).mockRejectedValueOnce(
      new WhatsAppProviderError(null, null, 'network lost'),
    );
    await dispatchPendingWhatsAppEventMessages(deps);
    await dispatchPendingWhatsAppEventMessages(deps);
    expect(deps.provider.sendMessage).toHaveBeenCalledTimes(1);
    expect(repo.completeProviderAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'UNCERTAIN', errorCode: 'PROVIDER_OUTCOME_UNKNOWN' }),
    );
  });

  it('marks a confirmed HTTP 400 rejection failed', async () => {
    const repo = repository();
    const deps = dependencies(repo);
    vi.mocked(deps.provider.sendMessage).mockRejectedValueOnce(
      new WhatsAppProviderError(400, 131008, 'rejected'),
    );
    await dispatchPendingWhatsAppEventMessages(deps);
    expect(repo.completeProviderAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'FAILED', errorCode: '131008' }),
    );
  });

  it('treats a provider 5xx as uncertain because acceptance is not knowable', async () => {
    const repo = repository();
    const deps = dependencies(repo);
    vi.mocked(deps.provider.sendMessage).mockRejectedValueOnce(
      new WhatsAppProviderError(503, null, 'unavailable'),
    );
    await dispatchPendingWhatsAppEventMessages(deps);
    expect(repo.completeProviderAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'UNCERTAIN', errorCode: 'PROVIDER_OUTCOME_UNKNOWN' }),
    );
  });

  it('recovers a lease that expires before any provider attempt', async () => {
    const begin = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(READY);
    const leasePending = vi
      .fn()
      .mockResolvedValueOnce([{ intentId: READY.intentId, leaseToken: 'old-token' }])
      .mockResolvedValueOnce([{ intentId: READY.intentId, leaseToken: 'new-token' }]);
    const repo = repository({ leasePending, beginProviderAttempt: begin });
    const deps = dependencies(repo);
    await dispatchPendingWhatsAppEventMessages(deps);
    await dispatchPendingWhatsAppEventMessages(deps);
    expect(deps.provider.sendMessage).toHaveBeenCalledTimes(1);
  });

  it.each([
    'wrong shop/channel',
    'pending template',
    'disabled rule',
    'missing eligible phone',
    'no active channel',
  ])('does not call the provider when canonical validation rejects %s', async () => {
    const deps = dependencies(repository({ beginProviderAttempt: vi.fn(async () => null) }));
    await dispatchPendingWhatsAppEventMessages(deps);
    expect(deps.provider.sendMessage).not.toHaveBeenCalled();
  });

  it('sends only canonical typed variables returned by the repository', async () => {
    const deps = dependencies();
    await dispatchPendingWhatsAppEventMessages(deps);
    expect(deps.provider.sendMessage).toHaveBeenCalledWith({
      providerPhoneNumberId: READY.providerPhoneNumberId,
      to: READY.recipientNormalizedPhone,
      kind: 'TEMPLATE',
      providerTemplateName: READY.providerTemplateName,
      languageCode: READY.languageCode,
      variables: READY.variables,
    });
  });
});

describe('handleWhatsAppEventDispatch', () => {
  function response() {
    return {
      statusCode: 0,
      headers: {} as Record<string, string>,
      setHeader(name: string, value: string) {
        this.headers[name] = value;
      },
      end: vi.fn(),
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json: vi.fn(),
    };
  }

  it('rejects an unauthorized internal request without dispatching', async () => {
    const dispatch = vi.fn();
    const res = response();
    await handleWhatsAppEventDispatch(
      {
        method: 'POST',
        headers: { authorization: 'Bearer wrong' },
        url: '/api/whatsapp?__internalTask=event-dispatch',
      } as never,
      res as never,
      { enabled: true, secret: 'x'.repeat(32), dispatch },
    );
    expect(res.statusCode).toBe(401);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('stays off unless the explicit dispatcher flag is enabled', async () => {
    const dispatch = vi.fn();
    const res = response();
    await handleWhatsAppEventDispatch(
      {
        method: 'POST',
        headers: { authorization: `Bearer ${'x'.repeat(32)}` },
        url: '/api/whatsapp?__internalTask=event-dispatch',
      } as never,
      res as never,
      { enabled: false, secret: 'x'.repeat(32), dispatch },
    );
    expect(res.statusCode).toBe(404);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
