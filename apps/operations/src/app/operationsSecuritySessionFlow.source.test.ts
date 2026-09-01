import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sessionClientSource = readFileSync(
  new URL('./sessionClient.ts', import.meta.url),
  'utf8',
);

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
    const configurationSync = bootstrap.indexOf(
      'configurationService.sync(bootstrap.shopId)',
    );
    const persistShop = bootstrap.indexOf('transaction.shops.put(bootstrap.shop)');
    const persistWorker = bootstrap.indexOf('transaction.workers.put(bootstrap.worker)');

    expect(configurationSync).toBeGreaterThanOrEqual(0);
    expect(persistShop).toBeGreaterThan(configurationSync);
    expect(persistWorker).toBeGreaterThan(configurationSync);
  });

  it('does not accept a cached local PIN before reachable backend authority can evaluate it', () => {
    const submitPin = functionBody('submitPin', 'getState');
    expect(submitPin).not.toMatch(
      /const local = await session\.submitPin\(pin\);[\s\S]*return local;/,
    );
    expect(submitPin).toContain('remoteGateway.authenticateWorker(pin)');
  });
});
