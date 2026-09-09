import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/20260908040000_online_order_acceptance_reservations.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('online-order delayed acceptance rejection fence', () => {
  it('keeps the first reservation owner and prevents a later claimant from rejecting that reserved identity', () => {
    expect(migration).toMatch(
      /online_order_processing_reservations[\s\S]*?origin_device_id uuid not null/,
    );
    expect(migration).toMatch(
      /insert into private\.online_order_processing_reservations\([\s\S]*?origin_device_id[\s\S]*?p_device_id/,
    );
    expect(migration).toMatch(
      /reject_tux_online_order_request_v1[\s\S]*?online_order_processing_reservations[\s\S]*?origin_device_id[\s\S]*?TUX_ONLINE_ORDER_REJECTION_FENCED/,
    );
  });
});
