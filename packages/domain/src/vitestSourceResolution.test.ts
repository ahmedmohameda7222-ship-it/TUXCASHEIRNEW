import { describe, expect, it } from 'vitest';
import {
  deliveryZoneContains as packageDeliveryZoneContains,
  resolveDeliveryRouting as packageResolveDeliveryRouting,
} from '@tux/domain';

import {
  deliveryZoneContains as sourceDeliveryZoneContains,
  resolveDeliveryRouting as sourceResolveDeliveryRouting,
} from './deliveryRouting';

// Compiled artifacts must remain the native Node/serverless contract.
// Vitest must, however, run the CURRENT source even after a developer edits
// the domain following npm ci. Identity catches a stale dist entry, rather
// than comparing equal outputs from identical but differently aged copies.
describe('@tux/domain Vitest source resolution', () => {
  it('imports live TypeScript source, not the previously compiled Node artifact', () => {
    expect(packageResolveDeliveryRouting).toBe(sourceResolveDeliveryRouting);
    expect(packageDeliveryZoneContains).toBe(sourceDeliveryZoneContains);
  });
});
