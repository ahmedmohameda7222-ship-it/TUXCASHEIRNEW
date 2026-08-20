import type {
  BusinessDayId,
  DeliveryZoneId,
  DraftLineId,
  ModifierId,
  OrderTypeId,
  PaymentMethodId,
  ProductId,
  ShopId,
} from './ids';
import type { MoneyMinor } from './money';
import type { ComboBeverageSnapshot, OrderModifierSnapshot } from './models';
import type { Instant } from './time';

export interface DraftOrderLine {
  readonly id: DraftLineId;
  readonly productId: ProductId;
  readonly productName: string;
  readonly unitPriceMinor: MoneyMinor;
  readonly quantity: number;
  readonly modifiers: readonly OrderModifierSnapshot[];
  readonly comboBeverages: readonly ComboBeverageSnapshot[];
  readonly itemNote: string | null;
  readonly addedSequence: number;
}

export interface DeliveryOrderDraft {
  readonly displayPhone: string;
  readonly normalizedPhone: string;
  readonly customerName: string;
  readonly address: string;
  readonly zoneId: DeliveryZoneId | null;
  readonly zoneLabel: string;
  readonly configuredFeeMinor: MoneyMinor;
  readonly finalFeeMinor: MoneyMinor;
}

export type PaymentDraft =
  | {
      readonly mode: 'NONE';
    }
  | {
      readonly mode: 'SINGLE';
      readonly methodId: PaymentMethodId;
      readonly cashReceivedMinor: MoneyMinor | null;
    }
  | {
      readonly mode: 'SPLIT';
      readonly methodAId: PaymentMethodId;
      readonly amountAMinor: MoneyMinor;
      readonly methodACashReceivedMinor: MoneyMinor | null;
      readonly methodBId: PaymentMethodId;
      readonly methodBCashReceivedMinor: MoneyMinor | null;
    };

export interface OrderDraft {
  readonly shopId: ShopId;
  readonly businessDayId: BusinessDayId;
  /**
   * Opaque local-runtime scope. Desktop currently has one primary renderer scope;
   * browser fallback creates one stable scope per tab/session. This prevents two
   * live renderer contexts from silently overwriting the same draft.
   */
  readonly draftScopeId: string;
  readonly revision: number;
  readonly updatedAt: Instant;
  /** Stable across retries of the same checkout intent, including restart recovery. */
  readonly checkoutIntentKey: string;
  readonly orderTypeId: OrderTypeId | null;
  readonly lines: readonly DraftOrderLine[];
  readonly orderNote: string | null;
  readonly discountMinor: MoneyMinor;
  readonly delivery: DeliveryOrderDraft;
  readonly payment: PaymentDraft;
}

export interface DraftModifierSelection {
  readonly modifierId: ModifierId;
  readonly quantity: number;
}

export interface DraftLineCustomization {
  readonly modifiers: readonly DraftModifierSelection[];
  readonly comboBeverageProductIds: readonly ProductId[];
  readonly itemNote: string | null;
}
