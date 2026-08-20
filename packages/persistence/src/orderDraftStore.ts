import type { BusinessDayId, OrderDraft, ShopId } from '@tux/domain';

export interface OrderDraftKey {
  readonly shopId: ShopId;
  readonly businessDayId: BusinessDayId;
  readonly draftScopeId: string;
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
  close(): Promise<void>;
}
