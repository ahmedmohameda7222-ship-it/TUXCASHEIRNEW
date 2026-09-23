import type {
  AdminDeliveryOrder,
  AdminDeliveryOrderState,
  AdminDeliveryRider,
} from '@tux/admin-contracts';
import { useState } from 'react';

const transitions: Readonly<
  Record<AdminDeliveryOrderState, readonly AdminDeliveryOrderState[]>
> = {
  UNASSIGNED: ['ASSIGNED'],
  ASSIGNED: ['UNASSIGNED', 'OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'FAILED', 'RETURNED'],
  DELIVERED: [],
  FAILED: [],
  RETURNED: [],
};

export function DeliveryOrderPanel({
  order,
  riders,
  saving,
  onTransition,
}: {
  order: AdminDeliveryOrder;
  riders: readonly AdminDeliveryRider[];
  saving: boolean;
  onTransition(input: {
    orderId: string;
    riderId: string | null;
    expectedVersion: number;
    toState: AdminDeliveryOrderState;
    note: string | null;
  }): void;
}) {
  const [riderId, setRiderId] = useState(order.riderId ?? '');
  const [note, setNote] = useState('');

  return (
    <article aria-label={`Delivery order ${order.orderId}`}>
      <header>
        <strong>{order.orderId}</strong>
        <span>{order.state}</span>
      </header>

      {order.state === 'UNASSIGNED' ? (
        <label className="admin-field">
          <span>Rider</span>
          <select
            value={riderId}
            onChange={(event) => setRiderId(event.target.value)}
          >
            <option value="">Select rider</option>
            {riders
              .filter(
                (rider) => rider.active && rider.state === 'AVAILABLE',
              )
              .map((rider) => (
                <option value={rider.id} key={rider.id}>
                  {rider.displayName}
                </option>
              ))}
          </select>
        </label>
      ) : null}

      <label className="admin-field">
        <span>Note</span>
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>

      <div className="admin-actions">
        {transitions[order.state].map((next) => (
          <button
            className="admin-secondary-button"
            type="button"
            disabled={
              saving ||
              (next === 'ASSIGNED' && !riderId)
            }
            key={next}
            onClick={() =>
              onTransition({
                orderId: order.orderId,
                riderId:
                  next === 'ASSIGNED'
                    ? riderId || null
                    : order.riderId,
                expectedVersion: order.version,
                toState: next,
                note: note.trim() || null,
              })
            }
          >
            {next}
          </button>
        ))}
      </div>
    </article>
  );
}
