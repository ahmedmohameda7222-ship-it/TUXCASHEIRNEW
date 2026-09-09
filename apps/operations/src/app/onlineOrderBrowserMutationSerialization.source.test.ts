import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('browser order mutation serialization', () => {
  it('locks acceptance through the durable tombstone', () => {
    const url = new URL('./OnlineOrderInboxPanel.tsx', import.meta.url);
    const panel = readFileSync(url, 'utf8');
    const lockCtor = /browserOnlineOrderMutations = new OnlineOrderMutationLock/;
    const uses = panel.match(/browserOnlineOrderMutations\.run\(/g) ?? [];

    expect(panel).toMatch(lockCtor);
    expect(uses.length).toBeGreaterThanOrEqual(4);

    const acceptTag = 'accept: async (request, confirmation) =>';
    const acceptStart = panel.indexOf(acceptTag);
    const subscribeStart = panel.indexOf('subscribe:', acceptStart);
    const acceptSource = panel.slice(acceptStart, subscribeStart);
    const lockTag = 'browserOnlineOrderMutations.run(request.requestId';
    const lockStart = acceptSource.indexOf(lockTag);
    const placeOrder = acceptSource.indexOf('acceptanceClient().accept');
    const tombstone = acceptSource.indexOf('store.markAccepted');

    expect(acceptStart).toBeGreaterThanOrEqual(0);
    expect(lockStart).toBeGreaterThanOrEqual(0);
    expect(placeOrder).toBeGreaterThan(lockStart);
    expect(tombstone).toBeGreaterThan(placeOrder);
  });
});
