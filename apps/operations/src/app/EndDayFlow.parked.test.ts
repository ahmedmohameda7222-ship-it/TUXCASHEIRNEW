import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./EndDayFlow.tsx', import.meta.url), 'utf8');

describe('Task 8E End Day parked draft presentation', () => {
  it('renders PARKED_DRAFTS_BLOCKED as a return-to-orders gate without discard automation', () => {
    expect(source).toContain("stage.gate.kind === 'PARKED_DRAFTS_BLOCKED'");
    expect(source).toContain('parked order');
    expect(source).toContain('onReturnToOrders');
    expect(source).not.toContain('discardParkedDraft');
  });
});
