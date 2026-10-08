import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const directory = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(directory, file), 'utf8');

describe('delivery Round 2 presentation', () => {
  it('uses route-backed Active Deliveries, Zones, and Riders workspaces', () => {
    const page = read('DeliveryPage.tsx');
    expect(page).toContain("'/delivery/zones'");
    expect(page).toContain("'/delivery/riders'");
    expect(page).toContain('Active deliveries');
  });

  it('uses business order labels and verb-based delivery actions', () => {
    const panel = read('DeliveryOrderPanel.tsx');
    expect(panel).toContain('displayOrderLabel');
    for (const label of [
      'Assign rider',
      'Unassign rider',
      'Start delivery',
      'Mark delivered',
      'Delivery failed',
      'Return order',
    ]) {
      expect(panel).toContain(label);
    }
    expect(panel).not.toContain('<strong>{order.orderId}</strong>');
  });

  it('uses focused editors, friendly rider availability, and structured zone points', () => {
    const zones = read('ZoneEditor.tsx');
    const riders = read('RidersPage.tsx');
    expect(zones).toContain('<AdminDialog');
    expect(zones).toContain('Add point');
    expect(zones).toContain('Remove point');
    expect(zones).not.toContain('Polygon points (latitude, longitude per line)');
    expect(riders).toContain('<AdminDialog');
    expect(riders).toContain('Available for delivery');
    expect(riders).toContain('Not available');
  });
});
