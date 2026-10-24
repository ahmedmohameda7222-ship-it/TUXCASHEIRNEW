import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('supabase/functions/operations-session-exit/index.ts', 'utf8');

describe('operations-session-exit Edge contract', () => {
  it('turns an already-ended heartbeat into the browser fencing status', () => {
    expect(source).toMatch(/action === 'HEARTBEAT'[\s\S]*?status'[\s\S]*?ALREADY_ENDED/);
    expect(source).toMatch(/ALREADY_ENDED'[\s\S]*?jsonResponse\(409/);
  });
});
