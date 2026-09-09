import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ipcSource = readFileSync(
  new URL('../../../apps/operations-desktop/src/main/onlineOrderInboxIpc.ts', import.meta.url),
  'utf8',
);
const mainSource = readFileSync(
  new URL('../../../apps/operations-desktop/src/main/index.ts', import.meta.url),
  'utf8',
);

describe('online-order local acceptance recovery', () => {
  it('reconciles a committed ONLINE order into the accepted tombstone before exposing review mutations', () => {
    expect(ipcSource).toContain('findCommittedOnlineOrder');
    expect(ipcSource).toMatch(/reconcile[\s\S]*?markAccepted/);
    expect(ipcSource).toMatch(/IPC_ONLINE_ORDERS_LOAD[\s\S]*?reconcile[\s\S]*?service\.load/);
    expect(ipcSource).toMatch(/IPC_ONLINE_ORDERS_RELEASE[\s\S]*?reconcile[\s\S]*?service\.release/);
    expect(ipcSource).toMatch(/IPC_ONLINE_ORDERS_REJECT[\s\S]*?reconcile[\s\S]*?service\.reject/);
    expect(mainSource).toMatch(/findCommittedOnlineOrder[\s\S]*?orders\.getById/);
  });
});
