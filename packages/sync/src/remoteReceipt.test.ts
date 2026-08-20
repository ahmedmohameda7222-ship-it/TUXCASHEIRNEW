import { describe, expect, it } from 'vitest';
import { decideRemoteReceiptV1, type RemoteReceiptIdentityV1 } from './remoteReceipt';

const incoming: RemoteReceiptIdentityV1 = {
  eventId: '11111111-1111-4111-8111-111111111111',
  shopId: '22222222-2222-4222-8222-222222222222',
  idempotencyKey: 'order:33333333-3333-4333-8333-333333333333:placed',
  payloadSha256: 'abc123',
};

describe('decideRemoteReceiptV1', () => {
  it('applies unseen events and treats identical retries as replay', () => {
    expect(
      decideRemoteReceiptV1({
        incoming,
        existingByEventId: null,
        existingByIdempotencyKey: null,
      }),
    ).toBe('APPLY');
    expect(
      decideRemoteReceiptV1({
        incoming,
        existingByEventId: incoming,
        existingByIdempotencyKey: incoming,
      }),
    ).toBe('REPLAY');
  });

  it('rejects conflicting reuse of either immutable identity', () => {
    expect(() =>
      decideRemoteReceiptV1({
        incoming,
        existingByEventId: { ...incoming, payloadSha256: 'different' },
        existingByIdempotencyKey: null,
      }),
    ).toThrow(/event ID/i);
    expect(() =>
      decideRemoteReceiptV1({
        incoming,
        existingByEventId: null,
        existingByIdempotencyKey: { ...incoming, eventId: 'different-event-id' },
      }),
    ).toThrow(/idempotency key/i);
  });
});
