import type {
  OrderRewardAuthority,
  OrderRewardClaimInput,
  OrderRewardReservation,
  OrderRewardReservationInput,
  OrderRewardReservationResult,
} from '@tux/application';
import { instant, moneyMinor, parseEntityId, type ProductId } from '@tux/domain';

type UnknownRecord = Record<string, unknown>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function object(value: unknown, label: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as UnknownRecord;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${label} must be a safe integer >= ${minimum}.`);
  }
  return value;
}

function nullableInteger(value: unknown, label: string, minimum = 0): number | null {
  return value === null ? null : integer(value, label, minimum);
}

function promotionKind(value: unknown): 'PERCENT' | 'FIXED' | 'FREE_ITEM' {
  if (value === 'PERCENT' || value === 'FIXED' || value === 'FREE_ITEM') return value;
  throw new TypeError('Reward promotion kind is unsupported.');
}

function promotionChannel(value: unknown): 'POS' | 'ONLINE' | 'BOTH' {
  if (value === 'POS' || value === 'ONLINE' || value === 'BOTH') return value;
  throw new TypeError('Reward promotion channel is unsupported.');
}

function parseReservation(value: unknown): OrderRewardReservation {
  const source = object(value, 'Reward reservation');
  if (source['ok'] !== true) throw new TypeError('Reward reservation did not succeed.');
  const reservationId = stringValue(source['reservationId'], 'Reward reservation id');
  if (!UUID_PATTERN.test(reservationId)) throw new TypeError('Reward reservation id is invalid.');
  const expiresAtText = stringValue(source['expiresAt'], 'Reward reservation expiry');
  const snapshot = object(source['snapshot'], 'Reward snapshot');

  const promotionValue = snapshot['promotion'];
  const promotion =
    promotionValue === null
      ? null
      : (() => {
          const rule = object(promotionValue, 'Reward promotion snapshot');
          const id = stringValue(rule['id'], 'Reward promotion id');
          if (!UUID_PATTERN.test(id)) throw new TypeError('Reward promotion id is invalid.');
          return {
            id,
            name: stringValue(rule['name'], 'Reward promotion name'),
            kind: promotionKind(rule['kind']),
            version: integer(rule['version'], 'Reward promotion version', 1),
            percentBasisPoints: nullableInteger(
              rule['percentBasisPoints'],
              'Reward promotion percentBasisPoints',
              1,
            ),
            fixedDiscountMinor:
              rule['fixedDiscountMinor'] === null
                ? null
                : moneyMinor(integer(rule['fixedDiscountMinor'], 'Reward fixed discount')),
            freeProductId:
              rule['freeProductId'] === null
                ? null
                : parseEntityId<ProductId>(
                    stringValue(rule['freeProductId'], 'Reward free product id'),
                  ),
            minimumOrderMinor: moneyMinor(
              integer(rule['minimumOrderMinor'], 'Reward minimum order'),
            ),
            channel: promotionChannel(rule['channel']),
            promotionDiscountMinor: moneyMinor(
              integer(rule['promotionDiscountMinor'], 'Reward promotion discount'),
            ),
          };
        })();

  const loyaltyValue = snapshot['loyalty'];
  const loyalty =
    loyaltyValue === null
      ? null
      : (() => {
          const rule = object(loyaltyValue, 'Reward loyalty snapshot');
          return {
            pointsRedeemed: integer(rule['pointsRedeemed'], 'Reward loyalty points', 1),
            redemptionMinorPerPoint: moneyMinor(
              integer(rule['redemptionMinorPerPoint'], 'Reward redemption value per point'),
            ),
            redemptionValueMinor: moneyMinor(
              integer(rule['redemptionValueMinor'], 'Reward redemption value'),
            ),
          };
        })();

  return {
    id: reservationId,
    expiresAt: instant(expiresAtText),
    replayed: source['replayed'] === true,
    snapshot: {
      configurationVersion: integer(
        snapshot['configurationVersion'],
        'Reward configuration version',
        1,
      ),
      rewardDiscountMinor: moneyMinor(integer(snapshot['rewardDiscountMinor'], 'Reward discount')),
      promotion,
      loyalty,
    },
  };
}

function businessFailure(value: UnknownRecord): OrderRewardReservationResult | null {
  if (value['ok'] !== false) return null;
  const code = typeof value['code'] === 'string' ? value['code'] : 'reward_not_available';
  return {
    ok: false,
    error: {
      code: 'REWARD_NOT_AVAILABLE',
      message:
        code === 'checkout_intent_conflict'
          ? 'This checkout intent was already reserved with different reward inputs.'
          : 'The requested reward is no longer available.',
    },
  };
}

export class BrowserOrderRewardAuthority implements OrderRewardAuthority {
  async reserve(input: OrderRewardReservationInput): Promise<OrderRewardReservationResult> {
    let response: Response;
    try {
      response = await fetch('/api/operations-order-rewards', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          action: 'RESERVE',
          shopId: input.shopId,
          checkoutIntentId: input.checkoutIntentId,
          channel: input.channel,
          customerPhone: input.customerPhone,
          promotionId: input.promotionId,
          loyaltyPointsToRedeem: input.loyaltyPointsToRedeem,
          items: input.items,
        }),
      });
    } catch {
      return {
        ok: false,
        error: {
          code: 'REWARD_REQUIRES_ONLINE_RESERVATION',
          message: 'Reward checkout requires the canonical reservation service to be online.',
        },
      };
    }

    let parsed: UnknownRecord;
    try {
      parsed = object(await response.json(), 'Reward response');
    } catch {
      return {
        ok: false,
        error: {
          code: 'REWARD_REQUIRES_ONLINE_RESERVATION',
          message: 'Reward checkout could not verify the canonical reservation response.',
        },
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        error: {
          code:
            response.status >= 500 || response.status === 401 || response.status === 403
              ? 'REWARD_REQUIRES_ONLINE_RESERVATION'
              : 'REWARD_NOT_AVAILABLE',
          message:
            response.status >= 500 || response.status === 401 || response.status === 403
              ? 'Reward checkout requires the canonical reservation service to be online.'
              : 'The requested reward could not be reserved.',
        },
      };
    }

    const failure = businessFailure(parsed);
    if (failure !== null) return failure;
    try {
      return { ok: true, value: parseReservation(parsed) };
    } catch {
      return {
        ok: false,
        error: {
          code: 'REWARD_REQUIRES_ONLINE_RESERVATION',
          message: 'Reward checkout received an invalid canonical reservation response.',
        },
      };
    }
  }

  async claim(input: OrderRewardClaimInput): Promise<OrderRewardReservationResult> {
    let response: Response;
    try {
      response = await fetch('/api/operations-order-rewards', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          action: 'CLAIM',
          shopId: input.shopId,
          reservationId: input.reservationId,
          checkoutIntentId: input.checkoutIntentId,
        }),
      });
    } catch {
      return {
        ok: false,
        error: {
          code: 'REWARD_REQUIRES_ONLINE_RESERVATION',
          message: 'Reward checkout requires the canonical reservation service to be online.',
        },
      };
    }

    let parsed: UnknownRecord;
    try {
      parsed = object(await response.json(), 'Reward response');
    } catch {
      return {
        ok: false,
        error: {
          code: 'REWARD_REQUIRES_ONLINE_RESERVATION',
          message: 'Reward checkout could not verify the canonical reservation response.',
        },
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        error: {
          code:
            response.status >= 500 || response.status === 401 || response.status === 403
              ? 'REWARD_REQUIRES_ONLINE_RESERVATION'
              : 'REWARD_NOT_AVAILABLE',
          message:
            response.status >= 500 || response.status === 401 || response.status === 403
              ? 'Reward checkout requires the canonical reservation service to be online.'
              : 'The requested reward could not be claimed.',
        },
      };
    }

    const failure = businessFailure(parsed);
    if (failure !== null) return failure;
    try {
      return { ok: true, value: parseReservation(parsed) };
    } catch {
      return {
        ok: false,
        error: {
          code: 'REWARD_REQUIRES_ONLINE_RESERVATION',
          message: 'Reward checkout received an invalid canonical reservation response.',
        },
      };
    }
  }

  async release(input: {
    readonly shopId: OrderRewardReservationInput['shopId'];
    readonly reservationId: string;
  }): Promise<void> {
    try {
      await fetch('/api/operations-order-rewards', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          action: 'RELEASE',
          shopId: input.shopId,
          reservationId: input.reservationId,
        }),
      });
    } catch {
      // Canonical reservations are bounded; expiry remains the fallback.
    }
  }
}
