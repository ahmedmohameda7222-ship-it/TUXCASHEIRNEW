export interface RemoteReceiptIdentityV1 {
  readonly eventId: string;
  readonly shopId: string;
  readonly idempotencyKey: string;
  readonly payloadSha256: string;
}

export type RemoteReceiptDecisionV1 = 'APPLY' | 'REPLAY';

function sameReceipt(
  left: RemoteReceiptIdentityV1,
  right: RemoteReceiptIdentityV1,
): boolean {
  return (
    left.eventId === right.eventId &&
    left.shopId === right.shopId &&
    left.idempotencyKey === right.idempotencyKey &&
    left.payloadSha256 === right.payloadSha256
  );
}

export function decideRemoteReceiptV1(input: {
  readonly incoming: RemoteReceiptIdentityV1;
  readonly existingByEventId: RemoteReceiptIdentityV1 | null;
  readonly existingByIdempotencyKey: RemoteReceiptIdentityV1 | null;
}): RemoteReceiptDecisionV1 {
  const { incoming, existingByEventId, existingByIdempotencyKey } = input;
  if (existingByEventId === null && existingByIdempotencyKey === null) return 'APPLY';

  if (existingByEventId !== null && !sameReceipt(existingByEventId, incoming)) {
    throw new Error('Remote sync event ID was reused with conflicting immutable content.');
  }
  if (existingByIdempotencyKey !== null && !sameReceipt(existingByIdempotencyKey, incoming)) {
    throw new Error('Remote sync idempotency key was reused with conflicting immutable content.');
  }
  return 'REPLAY';
}
