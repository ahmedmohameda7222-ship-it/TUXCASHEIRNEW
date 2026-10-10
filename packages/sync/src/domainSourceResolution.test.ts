import { describe, expect, it } from 'vitest';
import {
  deliveryZoneContains as packageDeliveryZoneContains,
  resolveDeliveryRouting as packageResolveDeliveryRouting,
} from '@tux/domain';

import {
  deliveryZoneContains as sourceDeliveryZoneContains,
  resolveDeliveryRouting as sourceResolveDeliveryRouting,
} from '../../domain/src/deliveryRouting';

// Workspace tests must import current domain source instead of stale compiled dist.
describe('@tux/sync workspace domain resolution', () => {
  it('shares current TypeScript domain function identities with @tux/domain', () => {
    expect(packageDeliveryZoneContains).toBe(sourceDeliveryZoneContains);
    expect(packageResolveDeliveryRouting).toBe(sourceResolveDeliveryRouting);
  });
});
