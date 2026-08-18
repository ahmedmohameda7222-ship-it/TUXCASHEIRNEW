import type {
  AuditEvent,
  BusinessDay,
  BusinessDayId,
  CustomerContact,
  Device,
  DeviceId,
  Expense,
  InventoryItem,
  InventoryMovement,
  OperationsConfigurationSnapshot,
  OrderId,
  OrderSnapshot,
  OutboxEvent,
  OutboxEventId,
  Reconciliation,
  Shop,
  ShopId,
  Worker,
  WorkerId,
  WorkerSession,
} from '@tux/domain';
import type { Instant } from '@tux/domain';

export interface ShopRepository {
  getById(id: ShopId): Promise<Shop | null>;
  put(shop: Shop): Promise<void>;
}

export interface DeviceRepository {
  getById(id: DeviceId): Promise<Device | null>;
  put(device: Device): Promise<void>;
}

export interface WorkerRepository {
  getById(id: WorkerId): Promise<Worker | null>;
  put(worker: Worker): Promise<void>;
}

export interface WorkerSessionRepository {
  put(session: WorkerSession): Promise<void>;
}

export interface ConfigurationRepository {
  getForShop(shopId: ShopId): Promise<OperationsConfigurationSnapshot | null>;
  put(snapshot: OperationsConfigurationSnapshot): Promise<void>;
}

export interface CustomerContactRepository {
  getByNormalizedPhone(shopId: ShopId, normalizedPhone: string): Promise<CustomerContact | null>;
  put(contact: CustomerContact): Promise<void>;
}

export interface BusinessDayRepository {
  getById(id: BusinessDayId): Promise<BusinessDay | null>;
  getOpenForShop(shopId: ShopId): Promise<BusinessDay | null>;
  put(day: BusinessDay): Promise<void>;
}

export interface OrderRepository {
  getById(id: OrderId): Promise<OrderSnapshot | null>;
  getByIdempotencyKey(shopId: ShopId, idempotencyKey: string): Promise<OrderSnapshot | null>;
  listByBusinessDay(businessDayId: BusinessDayId): Promise<readonly OrderSnapshot[]>;
  insert(order: OrderSnapshot): Promise<void>;
  updateOperationalState(order: OrderSnapshot): Promise<void>;
}

export interface ExpenseRepository {
  put(expense: Expense): Promise<void>;
}

export interface InventoryRepository {
  putItem(item: InventoryItem): Promise<void>;
  appendMovement(movement: InventoryMovement): Promise<void>;
  listMovementsForOrder(orderId: OrderId): Promise<readonly InventoryMovement[]>;
}

export interface ReconciliationRepository {
  put(reconciliation: Reconciliation): Promise<void>;
}

export interface AuditRepository {
  append(event: AuditEvent): Promise<void>;
}

export interface OutboxRepository {
  append(event: OutboxEvent): Promise<void>;
  listPending(now: Instant, limit: number): Promise<readonly OutboxEvent[]>;
  markDelivered(id: OutboxEventId, deliveredAt: Instant): Promise<void>;
  recordFailure(
    id: OutboxEventId,
    attemptCount: number,
    nextAttemptAt: Instant,
    lastError: string,
  ): Promise<void>;
}

export interface OperationsTransaction {
  readonly shops: ShopRepository;
  readonly devices: DeviceRepository;
  readonly workers: WorkerRepository;
  readonly workerSessions: WorkerSessionRepository;
  readonly configuration: ConfigurationRepository;
  readonly customerContacts: CustomerContactRepository;
  readonly businessDays: BusinessDayRepository;
  readonly orders: OrderRepository;
  readonly expenses: ExpenseRepository;
  readonly inventory: InventoryRepository;
  readonly reconciliations: ReconciliationRepository;
  readonly audit: AuditRepository;
  readonly outbox: OutboxRepository;
}

export interface OperationsDatabase {
  initialize(): Promise<void>;
  transaction<Result>(
    work: (transaction: OperationsTransaction) => Promise<Result>,
  ): Promise<Result>;
  close(): Promise<void>;
}
