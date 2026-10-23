import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sessionClientSource = readFileSync(new URL('./sessionClient.ts', import.meta.url), 'utf8');
const shopScopeSource = readFileSync(new URL('./browserShopScope.ts', import.meta.url), 'utf8');

function functionBody(name: string, nextName: string): string {
  const start = sessionClientSource.indexOf(`const ${name} =`);
  const end = sessionClientSource.indexOf(`const ${nextName} =`, start + 1);
  if (start < 0 || end < 0) {
    throw new Error(`Could not locate ${name} source boundary.`);
  }
  return sessionClientSource.slice(start, end);
}

describe('Operations browser security session flow', () => {
  it('does not persist first-use identity until configuration installation succeeds', () => {
    const bootstrap = functionBody('bootstrapWithPin', 'submitPin');
    const configurationSync = bootstrap.indexOf('configurationService.sync(bootstrap.shopId)');
    const persistBoth = bootstrap.indexOf(
      'selectBrowserShop(database, readModel, bootstrap.shop, bootstrap.worker)',
    );
    const localPin = bootstrap.indexOf('session.submitPin(pin)');

    expect(configurationSync).toBeGreaterThanOrEqual(0);
    // The new multi-shop helper only runs after configuration has been installed.
    expect(persistBoth).toBeGreaterThan(configurationSync);
    expect(localPin).toBeGreaterThan(persistBoth);
    // The helper itself must atomically persist the authorized shop and worker,
    // never before checking their active status and matching shop identity.
    expect(shopScopeSource).toContain('worker.shopId !== shop.id');
    expect(shopScopeSource).toContain('transaction.shops.put(shop)');
    expect(shopScopeSource).toContain('transaction.workers.put(worker)');
  });

  it('does not accept a cached local PIN before reachable backend authority can evaluate it', () => {
    const submitPin = functionBody('submitPin', 'getState');
    expect(submitPin).not.toMatch(
      /const local = await session\.submitPin\(pin\);[\s\S]*return local;/,
    );
    expect(submitPin).toContain('remoteGateway.authenticateWorker(pin)');
  });
});
