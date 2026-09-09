import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const browserRuntimeSource = readFileSync(
  new URL('./onlineOrderInboxClient.ts', import.meta.url),
  'utf8',
);
const desktopRuntimeSource = readFileSync(
  new URL('../../../operations-desktop/src/main/onlineOrderInboxIpc.ts', import.meta.url),
  'utf8',
);

describe('online-order inbox remote refresh lifecycle', () => {
  it('refreshes an open browser inbox periodically and immediately after reconnect', () => {
    expect(browserRuntimeSource).toContain('window.setInterval');
    expect(browserRuntimeSource).toContain("window.addEventListener('online'");
    expect(browserRuntimeSource).toContain("window.removeEventListener('online'");
    expect(browserRuntimeSource).toContain('window.clearInterval');
  });

  it('refreshes the desktop inbox while its IPC runtime is registered', () => {
    expect(desktopRuntimeSource).toContain('OPEN_INBOX_REFRESH_INTERVAL_MS');
    expect(desktopRuntimeSource).toContain('setInterval');
    expect(desktopRuntimeSource).toContain('this.#service.load()');
    expect(desktopRuntimeSource).toContain('clearInterval');
  });
});
