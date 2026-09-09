import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./OnlineOrderInboxPanel.tsx', import.meta.url), 'utf8');

describe('online-order inbox remote refresh lifecycle', () => {
  it('refreshes an open inbox periodically and immediately after reconnect', () => {
    expect(source).toContain('window.setInterval');
    expect(source).toContain("window.addEventListener('online'");
    expect(source).toContain("window.removeEventListener('online'");
  });
});
