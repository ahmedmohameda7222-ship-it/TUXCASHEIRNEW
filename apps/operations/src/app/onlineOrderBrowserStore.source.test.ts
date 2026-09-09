import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./OnlineOrderInboxPanel.tsx', import.meta.url), 'utf8');

describe('browser online-order inbox store lifecycle', () => {
  it('initializes one shared IndexedDB inbox store instead of recursively awaiting itself', () => {
    const storeFactory = source.match(
      /async function browserOnlineOrderInboxStore\(\)[\s\S]*?(?=async function browserOnlineOrderInboxClient)/,
    )?.[0];
    expect(storeFactory).toBeDefined();
    expect(storeFactory).toContain('new IndexedDbOnlineOrderInboxStore()');
    expect(storeFactory).toContain('await store.initialize()');
    expect(storeFactory).not.toContain('await browserOnlineOrderInboxStore()');

    const clientFactory = source.match(
      /async function browserOnlineOrderInboxClient\(\)[\s\S]*?(?=function acceptanceClient)/,
    )?.[0];
    expect(clientFactory).toContain('const store = await browserOnlineOrderInboxStore()');
    expect(clientFactory).not.toContain('new IndexedDbOnlineOrderInboxStore()');
  });
});
