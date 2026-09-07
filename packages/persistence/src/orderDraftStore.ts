import type {
  BusinessDayId,
  Instant,
  OrderDraft,
  ParkedOrderDraft,
  ShopId,
  WorkerId,
} from '@tux/domain';

export interface OrderDraftKey {
  readonly shopId: ShopId;
  readonly businessDayId: BusinessDayId;
  readonly draftScopeId: string;
}

export interface ParkAndReplaceOrderDraftInput {
  readonly activeKey: OrderDraftKey;
  readonly expectedActiveRevision: number;
  readonly parked: ParkedOrderDraft;
  readonly replacement: OrderDraft;
}

export interface RestoreParkedOrderDraftInput {
  readonly activeKey: OrderDraftKey;
  readonly expectedActiveRevision: number;
  readonly parkedId: string;
  readonly parkActiveAs: ParkedOrderDraft | null;
  readonly restoredAt: Instant;
  readonly restoredByWorkerId: WorkerId;
}

export interface ResolveParkedOrderDraftInput {
  readonly shopId: ShopId;
  readonly businessDayId: BusinessDayId;
  readonly parkedId: string;
  readonly resolvedAt: Instant;
  readonly resolvedByWorkerId: WorkerId;
}

/**
 * Draft persistence is intentionally outside OperationsDatabase transactions.
 * Drafts have no revenue, inventory, reporting, or order-history effect until
 * checkout succeeds through the transactional business-data boundary.
 */
export interface OrderDraftStore {
  initialize(): Promise<void>;
  get(key: OrderDraftKey): Promise<OrderDraft | null>;
  put(draft: OrderDraft): Promise<void>;
  delete(key: OrderDraftKey): Promise<void>;
  listParked(shopId: ShopId, businessDayId: BusinessDayId): Promise<readonly ParkedOrderDraft[]>;
  parkAndReplace(input: ParkAndReplaceOrderDraftInput): Promise<ParkedOrderDraft>;
  restoreParked(input: RestoreParkedOrderDraftInput): Promise<{
    readonly restoredDraft: OrderDraft;
    readonly parkedActive: ParkedOrderDraft | null;
  }>;
  discardParked(input: ResolveParkedOrderDraftInput): Promise<ParkedOrderDraft>;
  close(): Promise<void>;
}
