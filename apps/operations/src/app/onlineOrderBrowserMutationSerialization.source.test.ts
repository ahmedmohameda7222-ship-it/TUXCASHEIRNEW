import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('browser online-order mutation serialization source', () => {
  it('serializes same-request claim/release/reject/accept mutations through one keyed lock', () => {
    const source = readFileSync(new URL('./OnlineOrderInboxPanel.tsx', import.meta.url), 'utf8');
    expect(source).toContain('browserOnlineOrderMutationLock');
    expect(
      source.match(/browserOnlineOrderMutationLock\.run\(/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(4);
  });
});
