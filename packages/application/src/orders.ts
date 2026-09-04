import {
  allocateDisplayOrderNo,
  hasMeaningfulOrderDraft,
  normalizeEgyptianPhone,
  assertOrderSnapshotIntegrity,
  operationsSyncPayloadJson,
  parseEntityId,
  preparePaymentParts,
  stockQuantityMicros,
  validateOrderDraft,
  ZERO_MONEY,
  type AuditEvent,
  type AuditEventId,
  type BusinessDayId,
  type CustomerContact,
  type CustomerContactId,
  type DeliveryZoneId,
  type EntityId,
  type Instant,
  type InventoryItemId,
  type InventoryMovement,
  type InventoryMovementId,
  type OpenBusinessDay,
  type OperationsConfigurationSnapshot,
  type OperationsSyncPayloadV1,
  type OrderDraft,
  type OrderFulfillmentSnapshot,
  type OrderId,
  type OrderItemId,
  type OrderSnapshot,
  type OrderValidationIssue,
  type ParkedOrderDraft,
  type OutboxEvent,
  type OutboxEventId,
  type PaymentId,
  type PaymentPart,
  type ShopId,
  type Worker,
  type WorkerId,
} from '@tux/domain';
import type {
  OperationsDatabase,
  OperatorSessionReadModel,
  OrderDraftStore,
} from '@tux/persistence';
import { ApplicationCommandCoordinator } from './commandCoordinator';
import type { ApplicationError } from './errors';
import { unavailableOrderPrinter, type OrderPrinter } from './orderPrinter';
import { err, ok, type Result } from './result';

export interface OrdersRuntime {
  now(): Instant;
  createUuid(): string;
}

export interface OrdersCustomerPrefill {
  readonly normalizedPhone: string;
  readonly displayPhone: string;
  readonly customerName: string;
  readonly address: string | null;
  readonly zoneId: DeliveryZoneId | null;
}

export interface ParkedOrderSummary {
  readonly id: string;
  readonly parkedAt: Instant;
  readonly parkedByWorkerId: WorkerId;
  readonly lineCount: number;
  readonly customerName: string;
  readonly displayPhone: string;
  readonly totalQuantity: number;
}

export interface OrdersWorkspace {
  readonly shopId: ShopId;
  readonly businessDayId: BusinessDayId;
  readonly configuration: OperationsConfigurationSnapshot;
  readonly operator: {
    readonly id: Worker['id'];
    readonly displayName: string;
  };
  readonly draft: OrderDraft;
  readonly recoveryState: 'NONE' | 'PREVIOUS_ORDER_ALREADY_SAVED';
  readonly parkedDrafts: readonly ParkedOrderSummary[];
}

export interface OrderPlacement {
  readonly order: OrderSnapshot;
  readonly replayed: boolean;
  readonly nextDraft: OrderDraft;
  readonly postCommitWarnings: readonly string[];
}

export interface OrderPlacementError extends ApplicationError {
  readonly validationIssues?: readonly OrderValidationIssue[];
}

export type OrdersWorkspaceResult = Result<OrdersWorkspace, ApplicationError>;
export type OrderPlacementResult = Result<OrderPlacement, OrderPlacementError>;

interface ResolvedContext {
  readonly shopId: ShopId;
  readonly day: OpenBusinessDay;
  readonly configuration: OperationsConfigurationSnapshot;
  readonly operator: Worker;
}

interface CommittedOrderPlacement {
  readonly order: OrderSnapshot;
  readonly replayed: boolean;
  readonly configuration: OperationsConfigurationSnapshot;
}

interface DraftResetResult {
  readonly nextDraft: OrderDraft;
  readonly warnings: readonly string[];
}

function persistenceError(message: string, cause: unknown): ApplicationError {
  return { code: 'LOCAL_PERSISTENCE_ERROR', message, cause };
}

function firstActiveOrderTypeId(
  configuration: OperationsConfigurationSnapshot,
): OrderDraft['orderTypeId'] {
  const ordered = configuration.orderTypes
    .filter((orderType) => orderType.active)
    .sort((left, right) => left.sortOrder - right.sortOrder);
  return ordered[0]?.id ?? null;
}

export function createEmptyOrderDraft(input: {
  readonly shopId: ShopId;
  readonly businessDayId: BusinessDayId;
  readonly draftScopeId: string;
  readonly configuration: OperationsConfigurationSnapshot;
  readonly now: Instant;
  readonly checkoutIntentKey: string;
}): OrderDraft {
  return {
    shopId: input.shopId,
    businessDayId: input.businessDayId,
    draftScopeId: input.draftScopeId,
    revision: 0,
    updatedAt: input.now,
    checkoutIntentKey: input.checkoutIntentKey,
    orderTypeId: firstActiveOrderTypeId(input.configuration),
    lines: [],
    orderNote: null,
    discountMinor: ZERO_MONEY,
    delivery: {
      displayPhone: '',
      normalizedPhone: '',
      customerName: '',
      address: '',
      zoneId: null,
      zoneLabel: '',
      configuredFeeMinor: ZERO_MONEY,
      finalFeeMinor: ZERO_MONEY,
    },
    payment: { mode: 'NONE' },
  };
}

function parkedOrderSummary(value: ParkedOrderDraft): ParkedOrderSummary {
  const totalQuantity = value.draft.lines.reduce((total, line) => total + line.quantity, 0);
  if (!Number.isSafeInteger(totalQuantity)) {
    throw new RangeError('Parked order draft quantity exceeded the safe integer range.');
  }
  return {
    id: value.id,
    parkedAt: value.parkedAt,
    parkedByWorkerId: value.parkedByWorkerId,
    lineCount: value.draft.lines.length,
    customerName: value.draft.delivery.customerName,
    displayPhone: value.draft.delivery.displayPhone,
    totalQuantity,
  };
}

function parkedOrderDraft(input: {
  readonly id: string;
  readonly draft: OrderDraft;
  readonly parkedAt: Instant;
  readonly parkedByWorkerId: WorkerId;
}): ParkedOrderDraft {
  return {
    id: input.id,
    shopId: input.draft.shopId,
    businessDayId: input.draft.businessDayId,
    draftScopeId: input.draft.draftScopeId,
    draft: input.draft,
    parkedAt: input.parkedAt,
    parkedByWorkerId: input.parkedByWorkerId,
    state: 'PARKED',
    resolvedAt: null,
    resolvedByWorkerId: null,
  };
}

function orderDraftKey(draft: Pick<OrderDraft, 'shopId' | 'businessDayId' | 'draftScopeId'>) {
  return {
    shopId: draft.shopId,
    businessDayId: draft.businessDayId,
    draftScopeId: draft.draftScopeId,
  };
}

function addConsumption(
  usage: Map<InventoryItemId, number>,
  itemId: InventoryItemId,
  quantityMicros: number,
): void {
  const next = (usage.get(itemId) ?? 0) + quantityMicros;
  if (!Number.isSafeInteger(next)) {
    throw new RangeError('Inventory recipe consumption exceeded the safe integer range.');
  }
  usage.set(itemId, next);
}

function calculateInventoryConsumption(
  draft: OrderDraft,
  configuration: OperationsConfigurationSnapshot,
): ReadonlyMap<InventoryItemId, number> {
  const usage = new Map<InventoryItemId, number>();

  const addProductRecipe = (productId: string, multiplier: number): void => {
    if (!Number.isSafeInteger(multiplier) || multiplier <= 0) {
      throw new RangeError('Inventory recipe multiplier must be a positive safe integer.');
    }
    for (const recipe of configuration.recipeLines) {
      if (recipe.productId !== productId) continue;
      const quantity = recipe.quantityMicros * multiplier;
      if (!Number.isSafeInteger(quantity)) {
        throw new RangeError('Inventory recipe consumption exceeded the safe integer range.');
      }
      addConsumption(usage, recipe.inventoryItemId, quantity);
    }
  };

  for (const line of draft.lines) {
    addProductRecipe(line.productId, line.quantity);
    for (const beverage of line.comboBeverages) addProductRecipe(beverage.productId, 1);
    for (const modifierSnapshot of line.modifiers) {
      const modifier = configuration.modifiers.find(
        (candidate) => candidate.id === modifierSnapshot.modifierId,
      );
      if (modifier?.standaloneProductId !== null && modifier?.standaloneProductId !== undefined) {
        addProductRecipe(modifier.standaloneProductId, modifierSnapshot.quantity * line.quantity);
      }
    }
  }
  return usage;
}

export class OperationsOrdersService {
  readonly #database: OperationsDatabase;
  readonly #readModel: OperatorSessionReadModel;
  readonly #draftStore: OrderDraftStore;
  readonly #runtime: OrdersRuntime;
  readonly #coordinator: ApplicationCommandCoordinator;
  readonly #printer: OrderPrinter;

  constructor(
    database: OperationsDatabase,
    readModel: OperatorSessionReadModel,
    draftStore: OrderDraftStore,
    runtime: OrdersRuntime,
    coordinator = new ApplicationCommandCoordinator(),
    printer: OrderPrinter = unavailableOrderPrinter,
  ) {
    this.#database = database;
    this.#readModel = readModel;
    this.#draftStore = draftStore;
    this.#runtime = runtime;
    this.#coordinator = coordinator;
    this.#printer = printer;
  }

  async loadWorkspace(draftScopeId: string): Promise<OrdersWorkspaceResult> {
    return this.#coordinator.runExclusive(async () => {
      try {
        if (draftScopeId.trim().length === 0) {
          return err({ code: 'VALIDATION_ERROR', message: 'Draft scope is required.' });
        }
        const context = await this.#resolveContext();
        if (!context.ok) return context;
        const { shopId, day, configuration, operator } = context.value;
        const key = { shopId, businessDayId: day.id, draftScopeId };
        let draft = await this.#draftStore.get(key);
        let recoveryState: OrdersWorkspace['recoveryState'] = 'NONE';
        if (draft === null) {
          draft = createEmptyOrderDraft({
            shopId,
            businessDayId: day.id,
            draftScopeId,
            configuration,
            now: this.#runtime.now(),
            checkoutIntentKey: this.#runtime.createUuid(),
          });
          await this.#draftStore.put(draft);
        } else {
          const loadedDraft = draft;
          const committedOrder = await this.#database.transaction((transaction) =>
            transaction.orders.getByIdempotencyKey(shopId, loadedDraft.checkoutIntentKey),
          );
          if (committedOrder !== null) {
            draft = await this.#recoverCommittedDraftOnLoad(loadedDraft, configuration);
            recoveryState = 'PREVIOUS_ORDER_ALREADY_SAVED';
          }
        }
        return this.#workspaceResult({
          shopId,
          day,
          configuration,
          operator,
          draft,
          recoveryState,
        });
      } catch (cause) {
        return err(persistenceError('Could not load the local Orders workspace.', cause));
      }
    });
  }

  async startOrderFromCustomerPrefill(input: {
    readonly draftScopeId: string;
    readonly prefill: OrdersCustomerPrefill;
    readonly parkCurrent: boolean;
  }): Promise<OrdersWorkspaceResult> {
    return this.#coordinator.runExclusive(async () => {
      try {
        if (input.draftScopeId.trim().length === 0) {
          return err({ code: 'VALIDATION_ERROR', message: 'Draft scope is required.' });
        }
        const normalized = normalizeEgyptianPhone(
          input.prefill.normalizedPhone.trim() || input.prefill.displayPhone,
        );
        if (!normalized.valid) {
          return err({
            code: 'VALIDATION_ERROR',
            message: 'A valid Egyptian mobile number is required.',
          });
        }
        const context = await this.#resolveContext();
        if (!context.ok) return context;
        const { shopId, day, configuration, operator } = context.value;
        const key = { shopId, businessDayId: day.id, draftScopeId: input.draftScopeId };
        const current = await this.#draftStore.get(key);
        const meaningful = hasMeaningfulOrderDraft(current);
        if (meaningful && !input.parkCurrent) {
          return err({
            code: 'CONFLICT_ERROR',
            message: 'The current order contains customer work and must be parked explicitly.',
          });
        }
        const zone =
          input.prefill.zoneId === null
            ? undefined
            : configuration.deliveryZones.find(
                (candidate) => candidate.id === input.prefill.zoneId && candidate.active,
              );
        const now = this.#runtime.now();
        const base = createEmptyOrderDraft({
          shopId,
          businessDayId: day.id,
          draftScopeId: input.draftScopeId,
          configuration,
          now,
          checkoutIntentKey: this.#runtime.createUuid(),
        });
        const replacement: OrderDraft = {
          ...base,
          revision: current?.revision ?? base.revision,
          delivery: {
            ...base.delivery,
            normalizedPhone: normalized.normalizedPhone,
            displayPhone: input.prefill.displayPhone.trim() || normalized.displayPhone,
            customerName: input.prefill.customerName.trim(),
            address: input.prefill.address?.trim() ?? '',
            zoneId: zone?.id ?? null,
            zoneLabel: zone?.name ?? '',
            configuredFeeMinor: zone?.feeMinor ?? ZERO_MONEY,
            finalFeeMinor: zone?.feeMinor ?? ZERO_MONEY,
          },
        };
        if (current !== null && meaningful) {
          await this.#draftStore.parkAndReplace({
            activeKey: key,
            expectedActiveRevision: current.revision,
            parked: parkedOrderDraft({
              id: this.#runtime.createUuid(),
              draft: current,
              parkedAt: now,
              parkedByWorkerId: operator.id,
            }),
            replacement,
          });
        } else {
          await this.#draftStore.put(replacement);
        }
        return this.#workspaceResult({
          shopId,
          day,
          configuration,
          operator,
          draft: replacement,
          recoveryState: 'NONE',
        });
      } catch (cause) {
        return err(persistenceError('Could not start the customer-prefilled order.', cause));
      }
    });
  }

  async restoreParkedDraft(input: {
    readonly draftScopeId: string;
    readonly parkedDraftId: string;
    readonly parkCurrent: boolean;
  }): Promise<OrdersWorkspaceResult> {
    return this.#coordinator.runExclusive(async () => {
      try {
        if (input.draftScopeId.trim().length === 0 || input.parkedDraftId.trim().length === 0) {
          return err({
            code: 'VALIDATION_ERROR',
            message: 'Draft scope and parked draft are required.',
          });
        }
        const context = await this.#resolveContext();
        if (!context.ok) return context;
        const { shopId, day, configuration, operator } = context.value;
        const key = { shopId, businessDayId: day.id, draftScopeId: input.draftScopeId };
        const current = await this.#draftStore.get(key);
        if (current === null) {
          return err({
            code: 'CONFLICT_ERROR',
            message: 'The active Orders draft is unavailable.',
          });
        }
        const meaningful = hasMeaningfulOrderDraft(current);
        if (meaningful && !input.parkCurrent) {
          return err({
            code: 'CONFLICT_ERROR',
            message: 'The current order contains customer work and must be parked explicitly.',
          });
        }
        const now = this.#runtime.now();
        const restored = await this.#draftStore.restoreParked({
          activeKey: key,
          expectedActiveRevision: current.revision,
          parkedId: input.parkedDraftId,
          parkActiveAs:
            meaningful && input.parkCurrent
              ? parkedOrderDraft({
                  id: this.#runtime.createUuid(),
                  draft: current,
                  parkedAt: now,
                  parkedByWorkerId: operator.id,
                })
              : null,
          restoredAt: now,
          restoredByWorkerId: operator.id,
        });
        return this.#workspaceResult({
          shopId,
          day,
          configuration,
          operator,
          draft: restored.restoredDraft,
          recoveryState: 'NONE',
        });
      } catch (cause) {
        return err(persistenceError('Could not restore the parked order draft.', cause));
      }
    });
  }

  async discardParkedDraft(input: {
    readonly parkedDraftId: string;
  }): Promise<Result<true, ApplicationError>> {
    return this.#coordinator.runExclusive(async () => {
      try {
        if (input.parkedDraftId.trim().length === 0) {
          return err({ code: 'VALIDATION_ERROR', message: 'Parked draft is required.' });
        }
        const context = await this.#resolveContext();
        if (!context.ok) return context;
        await this.#draftStore.discardParked({
          shopId: context.value.shopId,
          businessDayId: context.value.day.id,
          parkedId: input.parkedDraftId,
          resolvedAt: this.#runtime.now(),
          resolvedByWorkerId: context.value.operator.id,
        });
        return ok(true);
      } catch (cause) {
        return err(persistenceError('Could not discard the parked order draft.', cause));
      }
    });
  }

  async saveDraft(draft: OrderDraft): Promise<Result<OrderDraft, ApplicationError>> {
    return this.#coordinator.runExclusive(async () => {
      try {
        const context = await this.#resolveContext();
        if (!context.ok) return context;
        if (
          draft.shopId !== context.value.shopId ||
          draft.businessDayId !== context.value.day.id ||
          draft.draftScopeId.trim().length === 0
        ) {
          return err({
            code: 'CONFLICT_ERROR',
            message: 'This draft no longer belongs to the active Business Day.',
          });
        }
        const updated: OrderDraft = {
          ...draft,
          revision: draft.revision + 1,
          updatedAt: this.#runtime.now(),
        };
        if (!Number.isSafeInteger(updated.revision)) {
          return err({ code: 'VALIDATION_ERROR', message: 'Draft revision overflowed.' });
        }
        await this.#draftStore.put(updated);
        return ok(updated);
      } catch (cause) {
        return err(persistenceError('Could not save the local order draft.', cause));
      }
    });
  }

  async findCustomerByPhone(
    shopId: ShopId,
    normalizedPhone: string,
  ): Promise<Result<CustomerContact | null, ApplicationError>> {
    return this.#coordinator.runExclusive(async () => {
      try {
        const contact = await this.#database.transaction((transaction) =>
          transaction.customerContacts.getByNormalizedPhone(shopId, normalizedPhone),
        );
        return ok(contact);
      } catch (cause) {
        return err(persistenceError('Could not read the local customer contact.', cause));
      }
    });
  }

  async placeOrder(draft: OrderDraft): Promise<OrderPlacementResult> {
    const committed = await this.#coordinator.runExclusive(
      async (): Promise<Result<CommittedOrderPlacement, OrderPlacementError>> => {
        try {
          const existing = await this.#database.transaction((transaction) =>
            transaction.orders.getByIdempotencyKey(draft.shopId, draft.checkoutIntentKey),
          );
          if (existing !== null) {
            const configuration = await this.#database.transaction((transaction) =>
              transaction.configuration.getForShop(existing.shopId),
            );
            if (configuration === null) {
              throw new Error(
                'Local configuration is unavailable while recovering a committed order.',
              );
            }
            return ok({ order: existing, replayed: true, configuration });
          }

          const contextResult = await this.#resolveContext();
          if (!contextResult.ok) return contextResult;
          const context = contextResult.value;
          if (
            draft.shopId !== context.shopId ||
            draft.businessDayId !== context.day.id ||
            draft.draftScopeId.trim().length === 0
          ) {
            return err({
              code: 'CONFLICT_ERROR',
              message: 'The order draft does not belong to the active Business Day.',
            });
          }

          const validation = validateOrderDraft(draft, context.configuration);
          if (!validation.valid) {
            return err({
              code: 'VALIDATION_ERROR',
              message: validation.issues[0]?.message ?? 'Order validation failed.',
              validationIssues: validation.issues,
            });
          }

          const preparedPayments = preparePaymentParts(
            draft.payment,
            context.configuration.paymentMethods,
            validation.value.pricing.totalMinor,
          );
          const inventoryUsage = calculateInventoryConsumption(draft, context.configuration);
          const committedAt = this.#runtime.now();
          const operator = context.operator;

          const commitResult = await this.#database.transaction(async (transaction) => {
            const replay = await transaction.orders.getByIdempotencyKey(
              draft.shopId,
              draft.checkoutIntentKey,
            );
            if (replay !== null) return { order: replay, replayed: true } as const;

            const currentDay = await transaction.businessDays.getOpenForShop(context.shopId);
            if (
              currentDay === null ||
              currentDay.status !== 'OPEN' ||
              currentDay.id !== draft.businessDayId
            ) {
              throw new Error('The Business Day changed before checkout could commit.');
            }
            const currentConfiguration = await transaction.configuration.getForShop(context.shopId);
            if (
              currentConfiguration === null ||
              currentConfiguration.version !== context.configuration.version
            ) {
              throw new Error('The local configuration changed before checkout could commit.');
            }
            const currentWorker = await transaction.workers.getById(operator.id);
            if (
              currentWorker === null ||
              !currentWorker.active ||
              currentWorker.shopId !== context.shopId
            ) {
              throw new Error('The Current Operator is no longer valid for checkout.');
            }

            const allocated = allocateDisplayOrderNo(currentDay);
            const orderId = this.#id<OrderId>();
            let customerContact: CustomerContact | null = null;
            if (
              validation.value.orderType.behavior === 'DELIVERY' &&
              validation.value.normalizedDeliveryPhone !== null
            ) {
              const existingContact = await transaction.customerContacts.getByNormalizedPhone(
                context.shopId,
                validation.value.normalizedDeliveryPhone,
              );
              customerContact = {
                id: existingContact?.id ?? this.#id<CustomerContactId>(),
                shopId: context.shopId,
                normalizedPhone: validation.value.normalizedDeliveryPhone,
                displayPhone:
                  draft.delivery.displayPhone.trim() || validation.value.normalizedDeliveryPhone,
                name: draft.delivery.customerName.trim(),
                latestAddress: draft.delivery.address.trim(),
                latestZoneId: draft.delivery.zoneId,
                lastOrderAt: committedAt,
              };
              await transaction.customerContacts.put(customerContact);
            }

            const fulfillment = this.#buildFulfillment(
              draft,
              validation.value.orderType,
              validation.value.normalizedDeliveryPhone,
              customerContact,
            );
            const payments = this.#buildPayments(preparedPayments);
            const order: OrderSnapshot = {
              id: orderId,
              shopId: context.shopId,
              businessDayId: currentDay.id,
              displayOrderNo: allocated.displayOrderNo,
              idempotencyKey: draft.checkoutIntentKey,
              status: 'ACTIVE',
              lifecycle: { revision: 0, doneAt: null, cancellation: null, returned: null },
              source: 'POS',
              operatorWorkerId: currentWorker.id,
              operatorName: currentWorker.displayName,
              createdAt: committedAt,
              fulfillment,
              items: draft.lines.map((line) => ({
                id: this.#id<OrderItemId>(),
                productId: line.productId,
                productName: line.productName,
                unitPriceMinor: line.unitPriceMinor,
                quantity: line.quantity,
                modifiers: line.modifiers,
                comboBeverages: line.comboBeverages,
                itemNote: line.itemNote,
              })),
              orderNote: draft.orderNote,
              itemsSubtotalMinor: validation.value.pricing.itemsSubtotalMinor,
              discountMinor: validation.value.pricing.discountMinor,
              deliveryFeeMinor: validation.value.pricing.deliveryFeeMinor,
              totalMinor: validation.value.pricing.totalMinor,
              payments,
            };
            assertOrderSnapshotIntegrity(order);

            await transaction.businessDays.put(allocated.businessDay);
            await transaction.orders.insert(order);

            const inventoryMovements: InventoryMovement[] = [];
            for (const [itemId, consumedMicros] of inventoryUsage) {
              if (consumedMicros === 0) continue;
              const movement: InventoryMovement = {
                id: this.#id<InventoryMovementId>(),
                shopId: context.shopId,
                businessDayId: currentDay.id,
                itemId,
                movementType: 'ORDER_CONSUMPTION',
                quantityDeltaMicros: stockQuantityMicros(-consumedMicros),
                idempotencyKey: `order-consumption:${order.id}:${itemId}`,
                workerId: currentWorker.id,
                orderId: order.id,
                createdAt: committedAt,
                compensatesMovementId: null,
              };
              inventoryMovements.push(movement);
              await transaction.inventory.appendMovement(movement);
            }

            await transaction.audit.append(this.#orderAudit(order, committedAt));
            await transaction.outbox.append(
              this.#orderOutbox(
                order,
                customerContact,
                inventoryMovements,
                context.configuration.version,
                committedAt,
              ),
            );
            return { order, replayed: false } as const;
          });

          return ok({
            order: commitResult.order,
            replayed: commitResult.replayed,
            configuration: context.configuration,
          });
        } catch (cause) {
          return err({
            code: 'LOCAL_PERSISTENCE_ERROR',
            message: 'The order was not placed because the local durable commit failed.',
            cause,
          });
        }
      },
    );

    if (!committed.ok) return committed;

    const warnings: string[] = [];
    if (!committed.value.replayed) {
      try {
        const printed = await this.#printer.print(committed.value.order);
        if (!printed.ok) warnings.push('PRINT_FAILED');
      } catch {
        warnings.push('PRINT_FAILED');
      }
    } else {
      warnings.push('PRINT_STATUS_UNKNOWN');
    }

    const reset = await this.#resetDraftAfterCommit(draft, committed.value.configuration, warnings);
    return ok({
      order: committed.value.order,
      replayed: committed.value.replayed,
      nextDraft: reset.nextDraft,
      postCommitWarnings: reset.warnings,
    });
  }

  async reprintOrder(orderId: OrderId): Promise<Result<OrderSnapshot, ApplicationError>> {
    const lookup = await this.#coordinator.runExclusive(
      async (): Promise<Result<OrderSnapshot, ApplicationError>> => {
        try {
          const order = await this.#database.transaction((transaction) =>
            transaction.orders.getById(orderId),
          );
          if (order === null) {
            return err({ code: 'NOT_FOUND', message: 'The saved order could not be found.' });
          }
          return ok(order);
        } catch (cause) {
          return err({
            code: 'LOCAL_PERSISTENCE_ERROR',
            message: 'The saved order could not be loaded for reprint.',
            cause,
          });
        }
      },
    );
    if (!lookup.ok) return lookup;

    try {
      const printed = await this.#printer.print(lookup.value);
      if (!printed.ok) return err({ code: 'PRINT_ERROR', message: printed.message });
      return lookup;
    } catch (cause) {
      return err({
        code: 'PRINT_ERROR',
        message: 'The saved order is intact, but the receipt could not be printed.',
        cause,
      });
    }
  }

  async #workspaceResult(input: {
    readonly shopId: ShopId;
    readonly day: OpenBusinessDay;
    readonly configuration: OperationsConfigurationSnapshot;
    readonly operator: Worker;
    readonly draft: OrderDraft;
    readonly recoveryState: OrdersWorkspace['recoveryState'];
  }): Promise<OrdersWorkspaceResult> {
    const parkedDrafts = await this.#draftStore.listParked(input.shopId, input.day.id);
    return ok({
      shopId: input.shopId,
      businessDayId: input.day.id,
      configuration: input.configuration,
      operator: { id: input.operator.id, displayName: input.operator.displayName },
      draft: input.draft,
      recoveryState: input.recoveryState,
      parkedDrafts: parkedDrafts.map(parkedOrderSummary),
    });
  }

  async #recoverCommittedDraftOnLoad(
    committedDraft: OrderDraft,
    configuration: OperationsConfigurationSnapshot,
  ): Promise<OrderDraft> {
    const key = orderDraftKey(committedDraft);
    const current = await this.#draftStore.get(key);
    if (current !== null && current.checkoutIntentKey !== committedDraft.checkoutIntentKey) {
      return current;
    }

    const candidate = createEmptyOrderDraft({
      shopId: committedDraft.shopId,
      businessDayId: committedDraft.businessDayId,
      draftScopeId: committedDraft.draftScopeId,
      configuration,
      now: this.#runtime.now(),
      checkoutIntentKey: this.#runtime.createUuid(),
    });
    if (current !== null) await this.#draftStore.delete(key);
    await this.#draftStore.put(candidate);
    return candidate;
  }

  async #resetDraftAfterCommit(
    committedDraft: OrderDraft,
    configuration: OperationsConfigurationSnapshot,
    initialWarnings: readonly string[],
  ): Promise<DraftResetResult> {
    const warnings = [...initialWarnings];
    const key = orderDraftKey(committedDraft);
    const candidate = createEmptyOrderDraft({
      shopId: committedDraft.shopId,
      businessDayId: committedDraft.businessDayId,
      draftScopeId: committedDraft.draftScopeId,
      configuration,
      now: this.#runtime.now(),
      checkoutIntentKey: this.#runtime.createUuid(),
    });
    try {
      const current = await this.#draftStore.get(key);
      if (current !== null && current.checkoutIntentKey !== committedDraft.checkoutIntentKey) {
        warnings.push('DRAFT_SCOPE_ADVANCED');
        return { nextDraft: current, warnings };
      }
      if (current !== null) await this.#draftStore.delete(key);
      await this.#draftStore.put(candidate);
      return { nextDraft: candidate, warnings };
    } catch {
      warnings.push('DRAFT_RESET_FAILED');
      return { nextDraft: candidate, warnings };
    }
  }

  async #resolveContext(): Promise<Result<ResolvedContext, ApplicationError>> {
    const shops = await this.#readModel.listActiveShops();
    const shop = shops.length === 1 ? shops[0] : undefined;
    if (shop === undefined) {
      return err({
        code: 'CONFLICT_ERROR',
        message: 'This device is not assigned to exactly one active shop.',
      });
    }
    const state = await this.#database.transaction(async (transaction) => {
      const day = await transaction.businessDays.getOpenForShop(shop.id);
      const configuration = await transaction.configuration.getForShop(shop.id);
      return { day, configuration };
    });
    if (state.day === null || state.day.status !== 'OPEN') {
      return err({ code: 'CONFLICT_ERROR', message: 'No active Business Day.' });
    }
    if (state.configuration === null) {
      return err({
        code: 'CONFLICT_ERROR',
        message: 'A valid local menu configuration is required before taking orders.',
      });
    }
    const session = await this.#readModel.getOpenWorkerSession(state.day.id);
    if (session === null || session.endedAt !== null) {
      return err({ code: 'CONFLICT_ERROR', message: 'A Current Operator is required.' });
    }
    const worker = await this.#database.transaction((transaction) =>
      transaction.workers.getById(session.workerId),
    );
    if (worker === null || !worker.active || worker.shopId !== shop.id) {
      return err({ code: 'CONFLICT_ERROR', message: 'The Current Operator is unavailable.' });
    }
    return ok({
      shopId: shop.id,
      day: state.day,
      configuration: state.configuration,
      operator: worker,
    });
  }

  #buildFulfillment(
    draft: OrderDraft,
    orderType: OperationsConfigurationSnapshot['orderTypes'][number],
    normalizedDeliveryPhone: string | null,
    customerContact: CustomerContact | null,
  ): OrderFulfillmentSnapshot {
    if (orderType.behavior !== 'DELIVERY') {
      return {
        orderTypeId: orderType.id,
        orderTypeLabel: orderType.name,
        behavior: orderType.behavior,
        delivery: null,
      };
    }
    if (
      draft.delivery.zoneId === null ||
      normalizedDeliveryPhone === null ||
      customerContact === null
    ) {
      throw new Error(
        'Validated Delivery order is missing its customer, zone, or normalized phone.',
      );
    }
    return {
      orderTypeId: orderType.id,
      orderTypeLabel: orderType.name,
      behavior: 'DELIVERY',
      delivery: {
        customerContactId: customerContact.id,
        customerName: draft.delivery.customerName.trim(),
        normalizedPhone: normalizedDeliveryPhone,
        address: draft.delivery.address.trim(),
        zoneId: draft.delivery.zoneId,
        zoneLabel: draft.delivery.zoneLabel,
        configuredFeeMinor: draft.delivery.configuredFeeMinor,
        finalFeeMinor: draft.delivery.finalFeeMinor,
      },
    };
  }

  #buildPayments(prepared: ReturnType<typeof preparePaymentParts>): readonly PaymentPart[] {
    return prepared.map((part) => {
      if (part.method.logicType === 'CASH') {
        if (part.receivedMinor === null || part.changeMinor === null) {
          throw new Error('Prepared Cash payment is missing received/change amounts.');
        }
        return {
          id: this.#id<PaymentId>(),
          method: { ...part.method, logicType: 'CASH' },
          allocatedMinor: part.allocatedMinor,
          receivedMinor: part.receivedMinor,
          changeMinor: part.changeMinor,
        };
      }
      return {
        id: this.#id<PaymentId>(),
        method: { ...part.method, logicType: part.method.logicType },
        allocatedMinor: part.allocatedMinor,
        receivedMinor: null,
        changeMinor: null,
      };
    });
  }

  #orderAudit(order: OrderSnapshot, createdAt: Instant): AuditEvent {
    return {
      id: this.#id<AuditEventId>(),
      shopId: order.shopId,
      businessDayId: order.businessDayId,
      aggregateType: 'ORDER',
      aggregateId: order.id,
      eventType: 'ORDER_PLACED',
      workerId: order.operatorWorkerId,
      createdAt,
      details: {
        orderId: order.id,
        displayOrderNo: order.displayOrderNo,
        totalMinor: order.totalMinor,
        idempotencyKey: order.idempotencyKey,
      },
    };
  }

  #orderOutbox(
    order: OrderSnapshot,
    customerContact: CustomerContact | null,
    inventoryMovements: readonly InventoryMovement[],
    configurationVersion: number,
    createdAt: Instant,
  ): OutboxEvent {
    const payload = {
      eventType: 'ORDER_PLACED',
      version: 1,
      order,
      customerContactUpsert: customerContact,
      inventoryMovements,
      configurationVersion,
    } satisfies OperationsSyncPayloadV1;
    return {
      id: this.#id<OutboxEventId>(),
      shopId: order.shopId,
      businessDayId: order.businessDayId,
      aggregateType: 'ORDER',
      aggregateId: order.id,
      aggregateRevision: 0,
      eventType: 'ORDER_PLACED',
      idempotencyKey: `order-placed:${order.id}`,
      payloadVersion: 1,
      payload: operationsSyncPayloadJson(payload),
      createdAt,
      attemptCount: 0,
      nextAttemptAt: null,
      lastError: null,
      deliveredAt: null,
    };
  }

  #id<Id extends EntityId>(): Id {
    return parseEntityId<Id>(this.#runtime.createUuid());
  }
}
