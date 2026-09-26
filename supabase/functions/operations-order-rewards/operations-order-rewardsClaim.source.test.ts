import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('operations reward claim bridge', () => {
  it('routes CLAIM through the authenticated device RPC with reservation and intent fencing', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'supabase/functions/operations-order-rewards/index.ts'),
      'utf8',
    );

    expect(source).toContain("action === 'CLAIM'");
    expect(source).toContain("'claim_operations_order_reward_reservation_v1'");
    expect(source).toContain('p_reservation_id: reservationId');
    expect(source).toContain('p_checkout_intent_id: checkoutIntentId');
  });


  it('exposes authenticated claim listing and reconciliation actions for crash recovery', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'supabase/functions/operations-order-rewards/index.ts'),
      'utf8',
    );

    expect(source).toContain("action === 'LIST_CLAIMS'");
    expect(source).toContain("'list_operations_reward_claims_v1'");
    expect(source).toContain("action === 'RECONCILE'");
    expect(source).toContain("'reconcile_operations_reward_claims_v1'");
    expect(source).toContain('p_committed_checkout_intent_ids');
  });
});
