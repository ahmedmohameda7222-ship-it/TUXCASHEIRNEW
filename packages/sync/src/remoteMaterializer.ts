import { parseOperationsSyncEnvelopeV1 } from '@tux/domain';
import type {
  ExpenseLedgerRecord,
  InventoryMovement,
  OperationsSyncEnvelopeV1,
  OrderSnapshot,
  OrderTransitionSyncSnapshotV1,
  Instant,
  Reconciliation,
  WorkerSession,
} from '@tux/domain';
import type { parseOperationsSyncPayloadV1 } from '@tux/domain';

export type RemoteMutationMode = 'UPSERT' | 'UPDATE';

export type RemoteMutationGuard =
  | {
      readonly kind: 'MONOTONIC_REVISION';
      readonly column: 'operational_revision' | 'lifecycle_revision';
      readonly incomingRevision: number;
    }
  | {
      readonly kind: 'MONOTONIC_TIMESTAMP';
      readonly column: 'last_order_at' | 'ended_at';
      readonly incomingTimestamp: Instant | null;
    }
  | {
      readonly kind: 'STATE_RANK';
      readonly column: 'status';
      readonly incomingStatus: string;
      readonly rank: Readonly<Record<string, number>>;
    };

export interface RemoteTableMutation {
  readonly table: string;
  readonly mode: RemoteMutationMode;
  readonly conflictColumns: readonly string[];
  readonly row: Readonly<Record<string, unknown>>;
  /** Receiver-side predicate. Existing newer state must make this mutation a no-op. */
  readonly guard: RemoteMutationGuard | null;
}

export interface RemoteMaterializationPlanV1 {
  readonly eventId: string;
  readonly shopId: string;
  readonly idempotencyKey: string;
  readonly eventType: string;
  readonly mutations: readonly RemoteTableMutation[];
}

function mutation(
  table: string,
  conflictColumns: readonly string[],
  row: Readonly<Record<string, unknown>>,
  options: {
    readonly mode?: RemoteMutationMode;
    readonly guard?: RemoteMutationGuard | null;
  } = {},
): RemoteTableMutation {
  return {
    table,
    mode: options.mode ?? 'UPSERT',
    conflictColumns,
    row,
    guard: options.guard ?? null,
  };
}

/** Deterministic receiver policy used by future SQL/HTTP materializers before applying a row. */
export function shouldApplyRemoteMutation(
  existing: Readonly<Record<string, unknown>> | null,
  planned: RemoteTableMutation,
): boolean {
  if (existing === null) return planned.mode === 'UPSERT';
  const guard = planned.guard;
  if (guard === null) return true;

  if (guard.kind === 'MONOTONIC_REVISION') {
    const current = existing[guard.column];
    if (current === null || current === undefined) return true;
    return (
      typeof current === 'number' &&
      Number.isSafeInteger(current) &&
      current >= 0 &&
      guard.incomingRevision >= current
    );
  }

  if (guard.kind === 'MONOTONIC_TIMESTAMP') {
    const current = existing[guard.column];
    if (guard.incomingTimestamp === null) return current === null || current === undefined;
    if (current === null || current === undefined) return true;
    if (typeof current !== 'string') return false;
    const currentTime = Date.parse(current);
    const incomingTime = Date.parse(guard.incomingTimestamp);
    return (
      Number.isFinite(currentTime) && Number.isFinite(incomingTime) && incomingTime >= currentTime
    );
  }

  const currentStatus = existing[guard.column];
  if (typeof currentStatus !== 'string') return false;
  const currentRank = guard.rank[currentStatus];
  const incomingRank = guard.rank[guard.incomingStatus];
  return currentRank !== undefined && incomingRank !== undefined && incomingRank >= currentRank;
}

function businessDayMutation(
  day: Extract<
    ReturnType<typeof parseOperationsSyncPayloadV1>,
    { eventType: 'BUSINESS_DAY_STARTED' | 'BUSINESS_DAY_CLOSED' }
  >['businessDay'],
): RemoteTableMutation {
  return mutation(
    'business_days',
    ['id'],
    {
      id: day.id,
      shop_id: day.shopId,
      status: day.status,
      started_at: day.startedAt,
      ended_at: day.endedAt,
      started_by_worker_id: day.startedByWorkerId,
      ended_by_worker_id: day.endedByWorkerId,
      last_allocated_display_order_no: day.lastAllocatedDisplayOrderNo,
    },
    {
      mode: day.status === 'CLOSED' ? 'UPDATE' : 'UPSERT',
      guard: {
        kind: 'STATE_RANK',
        column: 'status',
        incomingStatus: day.status,
        rank: { OPEN: 0, CLOSED: 1 },
      },
    },
  );
}

function workerSessionMutation(session: WorkerSession): RemoteTableMutation {
  const row = {
    id: session.id,
    shop_id: session.shopId,
    business_day_id: session.businessDayId,
    worker_id: session.workerId,
    started_at: session.startedAt,
    ended_at: session.endedAt,
  };
  if (session.endedAt === null) {
    return mutation('worker_sessions', ['id'], row, {
      guard: {
        kind: 'MONOTONIC_TIMESTAMP',
        column: 'ended_at',
        incomingTimestamp: null,
      },
    });
  }
  return mutation('worker_sessions', ['id'], row, {
    mode: 'UPDATE',
    guard: {
      kind: 'MONOTONIC_TIMESTAMP',
      column: 'ended_at',
      incomingTimestamp: session.endedAt,
    },
  });
}

function movementMutation(movement: InventoryMovement): RemoteTableMutation {
  return mutation('inventory_movements', ['id'], {
    id: movement.id,
    shop_id: movement.shopId,
    business_day_id: movement.businessDayId,
    inventory_item_id: movement.itemId,
    movement_type: movement.movementType,
    quantity_delta_micros: movement.quantityDeltaMicros,
    worker_id: movement.workerId,
    order_id: movement.orderId,
    compensates_movement_id: movement.compensatesMovementId,
    idempotency_key: movement.idempotencyKey,
    created_at: movement.createdAt,
  });
}

function expenseMutation(
  expense: ExpenseLedgerRecord,
  mode: RemoteMutationMode = 'UPSERT',
): RemoteTableMutation {
  if (expense.kind === 'DELIVERY_FAILED') {
    return mutation('expenses', ['id'], {
      id: expense.id,
      shop_id: expense.shopId,
      business_day_id: expense.businessDayId,
      kind: expense.kind,
      description: expense.description,
      amount_minor: null,
      paid_from: null,
      note: expense.note,
      order_id: expense.orderId,
      created_by_worker_id: expense.createdByWorkerId,
      created_at: expense.createdAt,
      updated_at: expense.createdAt,
      lifecycle_revision: 0,
      lifecycle_updated_at: null,
      lifecycle_updated_by_worker_id: null,
      deleted_at: null,
      deleted_by_worker_id: null,
      snapshot_json: expense,
    });
  }
  const lifecycle = expense.lifecycle;
  return mutation(
    'expenses',
    ['id'],
    {
      id: expense.id,
      shop_id: expense.shopId,
      business_day_id: expense.businessDayId,
      kind: expense.kind,
      description: expense.description,
      amount_minor: expense.amountMinor,
      paid_from: expense.paidFrom,
      note: expense.note,
      order_id: null,
      created_by_worker_id: expense.createdByWorkerId,
      created_at: expense.createdAt,
      updated_at: lifecycle.deletedAt ?? lifecycle.updatedAt ?? expense.createdAt,
      lifecycle_revision: lifecycle.revision,
      lifecycle_updated_at: lifecycle.updatedAt,
      lifecycle_updated_by_worker_id: lifecycle.updatedByWorkerId,
      deleted_at: lifecycle.deletedAt,
      deleted_by_worker_id: lifecycle.deletedByWorkerId,
      snapshot_json: expense,
    },
    {
      mode,
      guard: {
        kind: 'MONOTONIC_REVISION',
        column: 'lifecycle_revision',
        incomingRevision: lifecycle.revision,
      },
    },
  );
}

function orderLifecycle(order: OrderSnapshot) {
  return (
    order.lifecycle ?? {
      revision: 0,
      doneAt: null,
      cancellation: null,
      returned: null,
    }
  );
}

function orderPlacementMutations(
  order: OrderSnapshot,
  configurationVersion: number,
): RemoteTableMutation[] {
  const lifecycle = orderLifecycle(order);
  const delivery = order.fulfillment.delivery;
  const result: RemoteTableMutation[] = [
    mutation(
      'orders',
      ['id'],
      {
        id: order.id,
        shop_id: order.shopId,
        business_day_id: order.businessDayId,
        display_order_no: order.displayOrderNo,
        idempotency_key: order.idempotencyKey,
        source: order.source,
        status: order.status,
        operator_worker_id: order.operatorWorkerId,
        operator_name_snapshot: order.operatorName,
        order_type_id: order.fulfillment.orderTypeId,
        order_type_label_snapshot: order.fulfillment.orderTypeLabel,
        order_type_behavior_snapshot: order.fulfillment.behavior,
        customer_contact_id: delivery?.customerContactId ?? null,
        customer_name_snapshot: delivery?.customerName ?? null,
        normalized_phone_snapshot: delivery?.normalizedPhone ?? null,
        address_snapshot: delivery?.address ?? null,
        delivery_zone_id: delivery?.zoneId ?? null,
        delivery_zone_label_snapshot: delivery?.zoneLabel ?? null,
        configured_delivery_fee_minor: delivery?.configuredFeeMinor ?? 0,
        final_delivery_fee_minor: delivery?.finalFeeMinor ?? 0,
        items_subtotal_minor: order.itemsSubtotalMinor,
        discount_minor: order.discountMinor,
        total_minor: order.totalMinor,
        order_note: order.orderNote,
        created_at: order.createdAt,
        updated_at: order.createdAt,
        configuration_version: configurationVersion,
        operational_revision: lifecycle.revision,
        done_at: lifecycle.doneAt,
        cancelled_at: lifecycle.cancellation?.at ?? null,
        cancelled_by_worker_id: lifecycle.cancellation?.workerId ?? null,
        cancelled_by_worker_name_snapshot: lifecycle.cancellation?.workerName ?? null,
        cancellation_reason: lifecycle.cancellation?.reason ?? null,
        cancellation_food_prepared: lifecycle.cancellation?.foodPrepared ?? null,
        cancellation_stock_restored: lifecycle.cancellation?.stockRestored ?? null,
        returned_at: lifecycle.returned?.at ?? null,
        returned_by_worker_id: lifecycle.returned?.workerId ?? null,
        returned_by_worker_name_snapshot: lifecycle.returned?.workerName ?? null,
        return_reason: lifecycle.returned?.reason ?? null,
        snapshot_json: order,
      },
      {
        guard: {
          kind: 'MONOTONIC_REVISION',
          column: 'operational_revision',
          incomingRevision: lifecycle.revision,
        },
      },
    ),
  ];

  order.items.forEach((item, linePosition) => {
    result.push(
      mutation('order_items', ['id'], {
        id: item.id,
        shop_id: order.shopId,
        order_id: order.id,
        product_id: item.productId,
        product_name_snapshot: item.productName,
        unit_price_minor: item.unitPriceMinor,
        quantity: item.quantity,
        item_note: item.itemNote,
        line_position: linePosition,
        snapshot_json: item,
      }),
    );
    item.modifiers.forEach((modifier, position) => {
      result.push(
        mutation('order_item_modifiers', ['order_item_id', 'position'], {
          id: null,
          shop_id: order.shopId,
          order_item_id: item.id,
          modifier_id: modifier.modifierId,
          modifier_label_snapshot: modifier.label,
          unit_price_minor: modifier.unitPriceMinor,
          quantity: modifier.quantity,
          position,
        }),
      );
    });
    item.comboBeverages.forEach((beverage, unitIndex) => {
      result.push(
        mutation('order_item_combo_beverages', ['order_item_id', 'unit_index'], {
          id: null,
          shop_id: order.shopId,
          order_item_id: item.id,
          unit_index: unitIndex + 1,
          beverage_product_id: beverage.productId,
          beverage_label_snapshot: beverage.label,
        }),
      );
    });
  });

  order.payments.forEach((payment, index) => {
    result.push(
      mutation('payments', ['id'], {
        id: payment.id,
        shop_id: order.shopId,
        order_id: order.id,
        part_index: index + 1,
        payment_method_id: payment.method.id,
        payment_method_label_snapshot: payment.method.label,
        logic_type_snapshot: payment.method.logicType,
        allocated_minor: payment.allocatedMinor,
        received_minor: payment.receivedMinor,
        change_minor: payment.changeMinor,
        created_at: order.createdAt,
      }),
    );
  });
  return result;
}

function orderLifecycleMutation(order: OrderSnapshot): RemoteTableMutation {
  const lifecycle = orderLifecycle(order);
  const lastOperationalAt =
    lifecycle.returned?.at ?? lifecycle.cancellation?.at ?? lifecycle.doneAt ?? order.createdAt;
  return mutation(
    'orders',
    ['id'],
    {
      id: order.id,
      shop_id: order.shopId,
      status: order.status,
      updated_at: lastOperationalAt,
      operational_revision: lifecycle.revision,
      done_at: lifecycle.doneAt,
      cancelled_at: lifecycle.cancellation?.at ?? null,
      cancelled_by_worker_id: lifecycle.cancellation?.workerId ?? null,
      cancelled_by_worker_name_snapshot: lifecycle.cancellation?.workerName ?? null,
      cancellation_reason: lifecycle.cancellation?.reason ?? null,
      cancellation_food_prepared: lifecycle.cancellation?.foodPrepared ?? null,
      cancellation_stock_restored: lifecycle.cancellation?.stockRestored ?? null,
      returned_at: lifecycle.returned?.at ?? null,
      returned_by_worker_id: lifecycle.returned?.workerId ?? null,
      returned_by_worker_name_snapshot: lifecycle.returned?.workerName ?? null,
      return_reason: lifecycle.returned?.reason ?? null,
    },
    {
      mode: 'UPDATE',
      guard: {
        kind: 'MONOTONIC_REVISION',
        column: 'operational_revision',
        incomingRevision: lifecycle.revision,
      },
    },
  );
}

function reconciliationMutations(reconciliation: Reconciliation): RemoteTableMutation[] {
  const result: RemoteTableMutation[] = [
    mutation('reconciliations', ['id'], {
      id: reconciliation.id,
      shop_id: reconciliation.shopId,
      business_day_id: reconciliation.businessDayId,
      created_by_worker_id: reconciliation.createdByWorkerId,
      created_at: reconciliation.createdAt,
    }),
  ];
  reconciliation.lines.forEach((line) => {
    result.push(
      mutation('reconciliation_lines', ['reconciliation_id', 'payment_method_id'], {
        id: null,
        shop_id: reconciliation.shopId,
        reconciliation_id: reconciliation.id,
        payment_method_id: line.paymentMethod.id,
        payment_method_label_snapshot: line.paymentMethod.label,
        logic_type_snapshot: line.paymentMethod.logicType,
        expected_minor: line.expectedMinor,
        actual_minor: line.actualMinor,
        difference_minor: line.differenceMinor,
        variance_reason: line.varianceReason,
      }),
    );
  });
  return result;
}

function customerMutation(
  contact: NonNullable<
    Extract<
      ReturnType<typeof parseOperationsSyncPayloadV1>,
      { eventType: 'ORDER_PLACED' }
    >['customerContactUpsert']
  >,
): RemoteTableMutation {
  return mutation(
    'customer_contacts',
    ['id'],
    {
      id: contact.id,
      shop_id: contact.shopId,
      normalized_phone: contact.normalizedPhone,
      display_phone: contact.displayPhone,
      name: contact.name,
      latest_address: contact.latestAddress,
      latest_zone_id: contact.latestZoneId,
      last_order_at: contact.lastOrderAt,
      updated_at: contact.lastOrderAt,
    },
    {
      guard:
        contact.lastOrderAt === null
          ? null
          : {
              kind: 'MONOTONIC_TIMESTAMP',
              column: 'last_order_at',
              incomingTimestamp: contact.lastOrderAt,
            },
    },
  );
}

function statusEventMutation(
  envelope: OperationsSyncEnvelopeV1,
  order: OrderSnapshot,
  transition: OrderTransitionSyncSnapshotV1 | null,
): RemoteTableMutation {
  const eventType =
    envelope.eventType === 'ORDER_PLACED'
      ? 'PLACED'
      : envelope.eventType === 'ORDER_MARKED_DONE'
        ? 'MARKED_DONE'
        : envelope.eventType === 'ORDER_DONE_UNDONE'
          ? 'DONE_UNDONE'
          : envelope.eventType === 'ORDER_CANCELLED'
            ? 'CANCELLED'
            : 'DELIVERY_RETURNED';
  return mutation('order_status_events', ['id'], {
    id: envelope.eventId,
    shop_id: order.shopId,
    business_day_id: order.businessDayId,
    order_id: order.id,
    event_type: eventType,
    worker_id: transition?.workerId ?? order.operatorWorkerId,
    worker_name_snapshot: transition?.workerName ?? order.operatorName,
    reason: transition?.reason ?? null,
    restore_stock: transition?.stockRestored ?? null,
    food_prepared: transition?.foodPrepared ?? null,
    operational_revision: transition?.revision ?? 0,
    from_status: transition?.fromStatus ?? null,
    to_status: transition?.toStatus ?? 'ACTIVE',
    idempotency_key: envelope.idempotencyKey,
    created_at: transition?.at ?? order.createdAt,
  });
}

export function buildRemoteMaterializationPlanV1(envelope: unknown): RemoteMaterializationPlanV1 {
  const normalizedEnvelope = parseOperationsSyncEnvelopeV1(envelope);
  const payload = normalizedEnvelope.payload;
  const mutations: RemoteTableMutation[] = [];

  switch (payload.eventType) {
    case 'ORDER_PLACED':
      if (payload.customerContactUpsert !== null) {
        mutations.push(customerMutation(payload.customerContactUpsert));
      }
      mutations.push(...orderPlacementMutations(payload.order, payload.configurationVersion));
      mutations.push(statusEventMutation(normalizedEnvelope, payload.order, null));
      mutations.push(...payload.inventoryMovements.map(movementMutation));
      break;
    case 'ORDER_MARKED_DONE':
    case 'ORDER_DONE_UNDONE':
    case 'ORDER_CANCELLED':
    case 'DELIVERY_RETURNED':
      mutations.push(orderLifecycleMutation(payload.order));
      mutations.push(statusEventMutation(normalizedEnvelope, payload.order, payload.transition));
      mutations.push(...payload.inventoryMovements.map(movementMutation));
      if (payload.deliveryFailedExpense !== null) {
        mutations.push(expenseMutation(payload.deliveryFailedExpense));
      }
      break;
    case 'EXPENSE_CREATED':
    case 'EXPENSE_EDITED':
    case 'EXPENSE_DELETED':
      mutations.push(
        expenseMutation(
          payload.expense,
          payload.eventType === 'EXPENSE_CREATED' ? 'UPSERT' : 'UPDATE',
        ),
      );
      break;
    case 'INVENTORY_MOVEMENT_RECORDED':
      mutations.push(movementMutation(payload.movement));
      break;
    case 'BUSINESS_DAY_STARTED':
    case 'BUSINESS_DAY_CLOSED':
      mutations.push(businessDayMutation(payload.businessDay));
      break;
    case 'WORKER_SIGNED_IN':
    case 'WORKER_SWITCHED':
    case 'WORKER_SIGNED_OUT':
      if (payload.previousSession !== null)
        mutations.push(workerSessionMutation(payload.previousSession));
      mutations.push(workerSessionMutation(payload.session));
      break;
    case 'RECONCILIATION_RECORDED':
      mutations.push(...reconciliationMutations(payload.reconciliation));
      break;
  }

  for (const planned of mutations) {
    if (planned.row['shop_id'] !== normalizedEnvelope.shopId) {
      throw new TypeError(
        `Remote materialization attempted a cross-shop mutation for ${planned.table}.`,
      );
    }
  }
  return {
    eventId: normalizedEnvelope.eventId,
    shopId: normalizedEnvelope.shopId,
    idempotencyKey: normalizedEnvelope.idempotencyKey,
    eventType: normalizedEnvelope.eventType,
    mutations,
  };
}
