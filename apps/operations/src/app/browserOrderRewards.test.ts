import { parseEntityId, type ShopId } from '@tux/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrowserOrderRewardAuthority } from './browserOrderRewards';

const SHOP_ID = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const RESERVATION_ID = '22222222-2222-4222-8222-222222222222';
const CHECKOUT_INTENT_ID = '33333333-3333-4333-8333-333333333333';
const PROMOTION_ID = '44444444-4444-4444-8444-444444444444';

function claimedRewardResponse(): unknown {
  return {
    ok: true,
    replayed: true,
    reservationId: RESERVATION_ID,
    status: 'CLAIMED',
    expiresAt: '2026-09-24T06:30:00.000Z',
    snapshot: {
      configurationVersion: 4,
      rewardDiscountMinor: 500,
      promotion: {
        id: PROMOTION_ID,
        name: 'Claimed reward',
        kind: 'FIXED',
        version: 4,
        percentBasisPoints: null,
        fixedDiscountMinor: 500,
        freeProductId: null,
        minimumOrderMinor: 0,
        channel: 'BOTH',
        promotionDiscountMinor: 500,
      },
      loyalty: null,
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BrowserOrderRewardAuthority reward claim', () => {
  it('claims the canonical reservation for the checkout intent before local commit', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(claimedRewardResponse()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const authority = new BrowserOrderRewardAuthority();
    const result = await authority.claim({
      shopId: SHOP_ID,
      reservationId: RESERVATION_ID,
      checkoutIntentId: CHECKOUT_INTENT_ID,
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        id: RESERVATION_ID,
        replayed: true,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const request = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(body).toEqual({
      action: 'CLAIM',
      shopId: SHOP_ID,
      reservationId: RESERVATION_ID,
      checkoutIntentId: CHECKOUT_INTENT_ID,
    });
  });

  it('fails closed when the canonical claim service is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')));

    const authority = new BrowserOrderRewardAuthority();
    await expect(
      authority.claim({
        shopId: SHOP_ID,
        reservationId: RESERVATION_ID,
        checkoutIntentId: CHECKOUT_INTENT_ID,
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'REWARD_REQUIRES_ONLINE_RESERVATION',
        message: 'Reward checkout requires the canonical reservation service to be online.',
      },
    });
  });

  it('reconciles device-owned claims against durable local checkout intents after reconnect', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            claims: [
              { reservationId: RESERVATION_ID, checkoutIntentId: CHECKOUT_INTENT_ID },
              {
                reservationId: '55555555-5555-4555-8555-555555555555',
                checkoutIntentId: '66666666-6666-4666-8666-666666666666',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, committed: 1, expired: 1 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const authority = new BrowserOrderRewardAuthority();
    await authority.reconcileClaims(
      SHOP_ID,
      async (checkoutIntentId, reservationId) =>
        checkoutIntentId === CHECKOUT_INTENT_ID && reservationId === RESERVATION_ID,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const listBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(listBody).toEqual({ action: 'LIST_CLAIMS', shopId: SHOP_ID });

    const reconcileBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(reconcileBody).toEqual({
      action: 'RECONCILE',
      shopId: SHOP_ID,
      committedCheckoutIntentIds: [CHECKOUT_INTENT_ID],
    });
  });
  it('surfaces a failed canonical reconciliation response so the caller can retry', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            claims: [{ reservationId: RESERVATION_ID, checkoutIntentId: CHECKOUT_INTENT_ID }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'reward_authority_failed' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const authority = new BrowserOrderRewardAuthority();
    await expect(
      authority.reconcileClaims(SHOP_ID, async () => true),
    ).rejects.toThrow('Reward claim reconciliation failed');
  });

});
