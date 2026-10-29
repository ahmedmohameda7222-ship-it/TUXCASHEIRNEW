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
  it('requires remote PIN before opening an unconfigured browser session', () => {
    const bootstrap = functionBody('bootstrapWithPin', 'submitPin');
    const remotePin = bootstrap.indexOf('remoteGateway.bootstrap(pin, shopId)');
    const persistBoth = bootstrap.indexOf(
      'selectBrowserShop(database, readModel, bootstrap.shop, bootstrap.worker)',
    );
    const localPin = bootstrap.indexOf('session.submitPin(pin)');
    const backgroundSync = bootstrap.indexOf('startRemoteRuntime(signedIn.value.shopId)');

    expect(remotePin).toBeGreaterThanOrEqual(0);
    expect(persistBoth).toBeGreaterThan(remotePin);
    expect(localPin).toBeGreaterThan(persistBoth);
    expect(backgroundSync).toBeGreaterThan(localPin);
    expect(bootstrap).not.toContain('Could not install the Operations configuration');
    expect(bootstrap).not.toContain('configurationService.sync');
    expect(sessionClientSource).toContain('requireActivatedConfiguration: false');
    expect(sessionClientSource).toContain('tux:operations-menu-ready');
    expect(sessionClientSource).toContain('void refreshShopMenu(shopId)');
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
