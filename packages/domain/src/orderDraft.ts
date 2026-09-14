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
      /** Operator/provider reference when required by the selected method. */
      readonly reference?: string | null;
      /** Explicit operator acknowledgement when the selected method requires it. */
      readonly manualConfirmed?: boolean;
    }
  | {
      readonly mode: 'SPLIT';
      readonly methodAId: PaymentMethodId;
      readonly amountAMinor: MoneyMinor;
      readonly methodBId: PaymentMethodId;
      /** Independent reference for split leg A. */
      readonly referenceA?: string | null;
      /** Independent reference for split leg B. */
      readonly referenceB?: string | null;
      /** Independent manual-confirmation evidence for split leg A. */
      readonly manualConfirmedA?: boolean;
      /** Independent manual-confirmation evidence for split leg B. */
      readonly manualConfirmedB?: boolean;
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

export function hasMeaningfulOrderDraft(draft: OrderDraft | null): boolean {
  if (draft === null) return false;
  return (
    draft.lines.length > 0 ||
    (draft.orderNote?.trim().length ?? 0) > 0 ||
    draft.discountMinor !== 0 ||
    draft.payment.mode !== 'NONE' ||
    draft.delivery.displayPhone.trim().length > 0 ||
    draft.delivery.normalizedPhone.trim().length > 0 ||
    draft.delivery.customerName.trim().length > 0 ||
    draft.delivery.address.trim().length > 0 ||
    draft.delivery.zoneId !== null ||
    draft.delivery.finalFeeMinor !== 0
  );
}
