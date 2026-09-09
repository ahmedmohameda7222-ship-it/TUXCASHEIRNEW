import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('browser online-order mutation serialization source', () => {
  it('holds one browser request lock through acceptance placement and durable tombstoning', () => {
    const panel = readFileSync(new URL('./OnlineOrderInboxPanel.tsx', import.meta.url), 'utf8');

    expect(panel).toContain('const browserOnlineOrderMutations = new OnlineOrderMutationLock()');
    expect(
      panel.match(/browserOnlineOrderMutations\.run\(/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(4);

    const acceptStart = panel.indexOf('accept: async (request, confirmation) =>');
    const subscribeStart = panel.indexOf('subscribe:', acceptStart);
    const acceptSource = panel.slice(acceptStart, subscribeStart);
    const lockStart = acceptSource.indexOf('browserOnlineOrderMutations.run(request.requestId');
    const placeOrder = acceptSource.indexOf('acceptanceClient().accept');
    const tombstone = acceptSource.indexOf('store.markAccepted');

    expect(acceptStart).toBeGreaterThanOrEqual(0);
    expect(lockStart).toBeGreaterThanOrEqual(0);
    expect(placeOrder).toBeGreaterThan(lockStart);
    expect(tombstone).toBeGreaterThan(placeOrder);
  });
});
