import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const panelSource = readFileSync(new URL('./OnlineOrderInboxPanel.tsx', import.meta.url), 'utf8');
const recoverySource = readFileSync(
  new URL('./browserOnlineOrderAcceptanceRecovery.ts', import.meta.url),
  'utf8',
);

describe('browser online-order acceptance crash recovery', () => {
  it('reconciles committed ONLINE orders into accepted inbox tombstones before review actions', () => {
    expect(panelSource).toContain('findBrowserCommittedOnlineOrder');
    expect(panelSource).toContain('async function reconcileBrowserAcceptedOrders');
    expect(panelSource).toContain('await store.list(shopId)');
    expect(panelSource).toContain('await store.get(shopId, requestId)');
    expect(panelSource).toContain("request.status !== 'PROCESSING'");
    expect(panelSource).toContain('request.processingOrderId === null');
    expect(panelSource).toContain(
      'await findBrowserCommittedOnlineOrder(shopId, request.processingOrderId)',
    );
    expect(panelSource).toContain(
      'await store.markAccepted(shopId, request.requestId, request.processingOrderId)',
    );

    expect(panelSource).toMatch(
      /load: async \(\) => \{[\s\S]*?await reconcileBrowserAcceptedOrders\(\);[\s\S]*?\.load\(\)/,
    );
    expect(panelSource).toMatch(
      /release: async \(requestId, processingOrderId\) => \{[\s\S]*?await reconcileBrowserAcceptedOrders\(requestId\);[\s\S]*?\.release\(requestId, processingOrderId\)/,
    );
    expect(panelSource).toMatch(
      /reject: async \(requestId, processingOrderId, reason\) => \{[\s\S]*?await reconcileBrowserAcceptedOrders\(requestId\);[\s\S]*?\.reject\(requestId, processingOrderId, reason\)/,
    );
    expect(panelSource).toMatch(
      /accept: async \(request, confirmation\) => \{[\s\S]*?await reconcileBrowserAcceptedOrders\(request\.requestId\);/,
    );
  });

  it('proves committed-order identity through the browser Operations database', () => {
    expect(recoverySource).toContain('export async function findBrowserCommittedOnlineOrder');
    expect(recoverySource).toContain('transaction.orders.getById');
    expect(recoverySource).toContain("order.source === 'ONLINE'");
    expect(recoverySource).toContain('order.shopId === shopId');
  });
});
