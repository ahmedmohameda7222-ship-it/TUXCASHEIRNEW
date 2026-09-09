import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  exposed: null as unknown,
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: unknown) => {
      harness.exposed = api;
    },
  },
  ipcRenderer: {
    invoke: harness.invoke,
    on: harness.on,
    removeListener: harness.removeListener,
  },
}));

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('window', { addEventListener: vi.fn() });
  harness.exposed = null;
  await import('./index');
});

describe('online-order acceptance preload bridge', () => {
  it('exposes one validated onlineOrders.accept method through Electron IPC', async () => {
    const onlineOrders = (harness.exposed as { onlineOrders?: Record<string, unknown> })
      .onlineOrders;
    expect(typeof onlineOrders?.accept).toBe('function');
  });
});
