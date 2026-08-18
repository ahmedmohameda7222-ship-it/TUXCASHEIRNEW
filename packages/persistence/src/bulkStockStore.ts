import type {
  AuditEvent,
  BusinessDayId,
  InventoryItem,
  InventoryItemId,
  InventoryMovement,
  InventoryMovementId,
  OutboxEvent,
  ShopId,
  WorkerId,
} from '@tux/domain';

export interface BulkStockMovementCommit {
  readonly expectedBusinessDayId: BusinessDayId;
  readonly expectedWorkerId: WorkerId;
  readonly expectedShopId: ShopId;
  readonly movement: InventoryMovement;
  readonly audit: AuditEvent;
  readonly outbox: OutboxEvent;
  readonly expectedCompensatedMovementId: InventoryMovementId | null;
}

export interface BulkStockStore {
  initialize(): Promise<void>;
  listActiveItems(shopId: ShopId): Promise<readonly InventoryItem[]>;
  listMovements(itemId: InventoryItemId): Promise<readonly InventoryMovement[]>;
  getMovementById(id: InventoryMovementId): Promise<InventoryMovement | null>;
  hasCompensationFor(id: InventoryMovementId): Promise<boolean>;
  commitMovement(commit: BulkStockMovementCommit): Promise<void>;
  close(): Promise<void>;
}
