import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('online-order explicit release after lease requeue', () => {
  it('relinquishes the matching durable reservation even when the request is already PENDING', () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        'supabase/migrations/20260908057000_online_order_explicit_release_reservation.sql',
      ),
      'utf8',
    );

    const pendingBranch = source.match(
      /if\s+v_request\.status\s*=\s*'PENDING'\s+then([\s\S]*?)if\s+v_request\.status\s+<>\s*'PROCESSING'/i,
    )?.[1];

    expect(pendingBranch).toBeDefined();
    expect(pendingBranch).toMatch(/private\.online_order_processing_reservations/i);
    expect(pendingBranch).toMatch(/processing_order_id\s*=\s*p_processing_order_id/i);
    expect(pendingBranch).toMatch(/origin_device_id\s*=\s*p_device_id/i);
    expect(pendingBranch).toMatch(/delete\s+from\s+private\.online_order_processing_reservations/i);
  });
});
