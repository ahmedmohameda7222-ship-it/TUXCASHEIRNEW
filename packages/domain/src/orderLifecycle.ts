import { DomainInvariantError } from './errors';
import type { WorkerId } from './ids';
import type { OrderLifecycleSnapshot, OrderSnapshot } from './models';
import type { Instant } from './time';

export const DONE_UNDO_WINDOW_MS = 8_000;

export function orderLifecycle(order: OrderSnapshot): OrderLifecycleSnapshot {
  return (
    order.lifecycle ?? {
      revision: 0,
      doneAt: null,
      cancellation: null,
      returned: null,
    }
  );
}

function nextRevision(order: OrderSnapshot): number {
  const next = orderLifecycle(order).revision + 1;
  if (!Number.isSafeInteger(next) || next <= 0) {
    throw new DomainInvariantError('Order operational revision overflowed its safe range.');
  }
  return next;
}

export function markOrderDone(order: OrderSnapshot, at: Instant): OrderSnapshot {
  if (order.status !== 'ACTIVE') {
    throw new DomainInvariantError('Only an ACTIVE order can be marked Done.');
  }
  const current = orderLifecycle(order);
  return {
    ...order,
    status: 'DONE',
    lifecycle: {
      ...current,
      revision: nextRevision(order),
      doneAt: at,
    },
  };
}

export function canUndoOrderDone(order: OrderSnapshot, now: Instant): boolean {
  if (order.status !== 'DONE') return false;
  const doneAt = orderLifecycle(order).doneAt;
  if (doneAt === null) return false;
  const elapsed = Date.parse(now) - Date.parse(doneAt);
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= DONE_UNDO_WINDOW_MS;
}

export function undoOrderDone(order: OrderSnapshot): OrderSnapshot {
  if (order.status !== 'DONE' || orderLifecycle(order).doneAt === null) {
    throw new DomainInvariantError('Only a recently completed order can be returned to ACTIVE.');
  }
  const current = orderLifecycle(order);
  return {
    ...order,
    status: 'ACTIVE',
    lifecycle: {
      ...current,
      revision: nextRevision(order),
      doneAt: null,
    },
  };
}

export function cancelActiveOrder(
  order: OrderSnapshot,
  input: {
    readonly at: Instant;
    readonly workerId: WorkerId;
    readonly workerName: string;
    readonly foodPrepared: boolean;
    readonly reason: string;
  },
): OrderSnapshot {
  if (order.status !== 'ACTIVE') {
    throw new DomainInvariantError('Only an ACTIVE order can be cancelled.');
  }
  const reason = input.reason.trim();
  if (reason.length === 0) {
    throw new DomainInvariantError('Cancellation reason is required.');
  }
  const current = orderLifecycle(order);
  return {
    ...order,
    status: 'CANCELLED',
    lifecycle: {
      ...current,
      revision: nextRevision(order),
      doneAt: null,
      cancellation: {
        at: input.at,
        workerId: input.workerId,
        workerName: input.workerName,
        foodPrepared: input.foodPrepared,
        stockRestored: !input.foodPrepared,
        reason,
      },
    },
  };
}

export function returnFailedDelivery(
  order: OrderSnapshot,
  input: {
    readonly at: Instant;
    readonly workerId: WorkerId;
    readonly workerName: string;
    readonly reason: string;
  },
): OrderSnapshot {
  if (order.status !== 'DONE' || order.fulfillment.behavior !== 'DELIVERY') {
    throw new DomainInvariantError('Only a DONE Delivery order can be marked Delivery Failed.');
  }
  const reason = input.reason.trim();
  if (reason.length === 0) {
    throw new DomainInvariantError('Delivery Failed reason is required.');
  }
  const current = orderLifecycle(order);
  return {
    ...order,
    status: 'RETURNED',
    lifecycle: {
      ...current,
      revision: nextRevision(order),
      doneAt: current.doneAt,
      returned: {
        at: input.at,
        workerId: input.workerId,
        workerName: input.workerName,
        reason,
      },
    },
  };
}
