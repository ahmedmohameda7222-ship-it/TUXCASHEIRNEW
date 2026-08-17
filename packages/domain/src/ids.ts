import { brandValue, type Brand } from './brand';
import { DomainInvariantError } from './errors';

export type ShopId = Brand<string, 'ShopId'>;
export type DeviceId = Brand<string, 'DeviceId'>;
export type WorkerId = Brand<string, 'WorkerId'>;
export type WorkerSessionId = Brand<string, 'WorkerSessionId'>;
export type BusinessDayId = Brand<string, 'BusinessDayId'>;
export type OrderId = Brand<string, 'OrderId'>;
export type OrderItemId = Brand<string, 'OrderItemId'>;
export type PaymentId = Brand<string, 'PaymentId'>;
export type ExpenseId = Brand<string, 'ExpenseId'>;
export type InventoryItemId = Brand<string, 'InventoryItemId'>;
export type InventoryMovementId = Brand<string, 'InventoryMovementId'>;
export type ReconciliationId = Brand<string, 'ReconciliationId'>;
export type AuditEventId = Brand<string, 'AuditEventId'>;
export type OutboxEventId = Brand<string, 'OutboxEventId'>;
export type ProductId = Brand<string, 'ProductId'>;
export type ModifierId = Brand<string, 'ModifierId'>;
export type PaymentMethodId = Brand<string, 'PaymentMethodId'>;
export type OrderTypeId = Brand<string, 'OrderTypeId'>;
export type DeliveryZoneId = Brand<string, 'DeliveryZoneId'>;
export type CustomerContactId = Brand<string, 'CustomerContactId'>;

export type EntityId =
  | ShopId
  | DeviceId
  | WorkerId
  | WorkerSessionId
  | BusinessDayId
  | OrderId
  | OrderItemId
  | PaymentId
  | ExpenseId
  | InventoryItemId
  | InventoryMovementId
  | ReconciliationId
  | AuditEventId
  | OutboxEventId
  | ProductId
  | ModifierId
  | PaymentMethodId
  | OrderTypeId
  | DeliveryZoneId
  | CustomerContactId;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseEntityId<Id extends EntityId>(value: string): Id {
  if (!UUID_PATTERN.test(value)) {
    throw new DomainInvariantError(`Invalid UUID entity identifier: ${value}`);
  }
  return brandValue<string, Id extends Brand<string, infer Name> ? Name : never>(value) as Id;
}
