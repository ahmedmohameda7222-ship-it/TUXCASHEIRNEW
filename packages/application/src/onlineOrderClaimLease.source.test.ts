import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/20260908030000_online_order_operations_claims.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('online-order processing claim lease', () => {
  it('requeues expired processing rows before list visibility and permits a fresh claim', () => {
    expect(migration).toMatch(
      /list_tux_online_order_requests_v1[\s\S]*?update public\.online_order_requests[\s\S]*?status = 'PENDING'[\s\S]*?request\.status = 'PROCESSING'[\s\S]*?request\.processing_expires_at <= now\(\)/,
    );
    expect(migration).toMatch(
      /claim_tux_online_order_request_v1[\s\S]*?v_request\.status = 'PROCESSING'[\s\S]*?v_request\.processing_expires_at <= now\(\)[\s\S]*?status = 'PROCESSING'[\s\S]*?processing_device_id = p_device_id/,
    );
  });
});
