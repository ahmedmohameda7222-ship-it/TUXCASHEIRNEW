import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const manifest = JSON.parse(await readFile('packages/domain/package.json', 'utf8'));
assert.equal(manifest.exports['.'].default, './dist/index.js');
const resolved = require.resolve('@tux/domain');
assert.ok(resolved.endsWith('/packages/domain/dist/index.js'), resolved);

// This is intentionally a NATIVE Node dynamic import, not Vite SSR, tsx,
// ts-node or an experimental TypeScript loader.
const { deliveryZoneContains, isDeliveryRoutingOpen, resolveDeliveryRouting } =
  await import('@tux/domain');
const zone = {
  id: 'smoke-zone',
  name: 'Local',
  feeMinor: 1000,
  minimumOrderMinor: 2000,
  priority: 1,
  active: true,
  boundary: { kind: 'RADIUS', latitude: 30, longitude: 31, radiusMeters: 1000 },
  fallbackShopId: null,
  fallbackEnabled: false,
  sortOrder: 0,
};
const at = '2026-10-10T12:00:00+03:00';
const hours = [{ dayOfWeek: 6, opensLocal: '00:00', closesLocal: '23:59', active: true }];
assert.equal(deliveryZoneContains(zone, { latitude: 30, longitude: 31 }), true);
assert.equal(isDeliveryRoutingOpen(hours, at), true);
assert.deepEqual(
  resolveDeliveryRouting(
    { requestedShopAvailable: true, requestedShopHours: hours, zones: [zone], fallbackShops: {} },
    { requestedShopId: 'smoke-shop', latitude: 30, longitude: 31, subtotalMinor: 5000, at },
  ),
  {
    ok: true,
    shopId: 'smoke-shop',
    zoneId: 'smoke-zone',
    zoneName: 'Local',
    feeMinor: 1000,
    minimumOrderMinor: 2000,
    fallbackUsed: false,
  },
);
console.log('Native Node @tux/domain delivery routing runtime smoke passed.');
