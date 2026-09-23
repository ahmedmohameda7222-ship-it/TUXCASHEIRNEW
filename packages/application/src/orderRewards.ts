import type {
  Instant,
  ModifierId,
  OrderAppliedRewardSnapshot,
  ProductId,
  ShopId,
} from '@tux/domain';

export interface OrderRewardReservationInput {
  readonly shopId: ShopId;
  readonly checkoutIntentId: string;
  readonly channel: 'POS' | 'ONLINE';
  readonly customerPhone: string | null;
  readonly promotionId: string | null;
  readonly loyaltyPointsToRedeem: number;
  readonly items: readonly {
    readonly productId: ProductId;
    readonly quantity: number;
    readonly modifiers: readonly {
      readonly modifierId: ModifierId;
      readonly quantity: number;
    }[];
    readonly comboBeverageProductIds: readonly ProductId[];
  }[];
}

export interface OrderRewardReservation {
  readonly id: string;
  readonly expiresAt: Instant;
  readonly replayed: boolean;
  readonly snapshot: OrderAppliedRewardSnapshot;
}

export type OrderRewardAuthorityErrorCode =
  | 'REWARD_REQUIRES_ONLINE_RESERVATION'
  | 'REWARD_NOT_AVAILABLE';

export interface OrderRewardAuthorityError {
  readonly code: OrderRewardAuthorityErrorCode;
  readonly message: string;
}

export type OrderRewardReservationResult =
  | { readonly ok: true; readonly value: OrderRewardReservation }
  | { readonly ok: false; readonly error: OrderRewardAuthorityError };

export interface OrderRewardAuthority {
  reserve(input: OrderRewardReservationInput): Promise<OrderRewardReservationResult>;
  release(input: { readonly shopId: ShopId; readonly reservationId: string }): Promise<void>;
}

export const unavailableOrderRewardAuthority: OrderRewardAuthority = {
  async reserve() {
    return {
      ok: false,
      error: {
        code: 'REWARD_REQUIRES_ONLINE_RESERVATION',
        message: 'This reward requires an online canonical reservation before checkout.',
      },
    };
  },
  async release() {},
};
