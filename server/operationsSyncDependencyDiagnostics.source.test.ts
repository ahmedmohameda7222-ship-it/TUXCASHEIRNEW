import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('operations-sync dependency diagnostics', () => {
  it('identifies a missing order so the browser can replay its immutable placement origin', () => {
    const source = readFileSync('supabase/functions/operations-sync/index.ts', 'utf8');

    expect(source).toContain('TUX_DEPENDENCY_MISSING:orders.');
    expect(source).toContain("error: 'order_dependency_not_ready'");
    expect(source).toContain('missingOrderId:');
  });
});
