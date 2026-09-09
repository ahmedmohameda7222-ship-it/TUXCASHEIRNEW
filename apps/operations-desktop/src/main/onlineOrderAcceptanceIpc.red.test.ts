import { describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
    removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
  };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: electron.handle,
    removeHandler: electron.removeHandler,
  },
}));
vi.mock('./security', () => ({ assertTrustedIpcSender: vi.fn() }));

import { OnlineOrderInboxIpcRuntime } from './onlineOrderInboxIpc';

function service() {
  return {
    load: vi.fn(),
    claim: vi.fn(),
    release: vi.fn(),
    reject: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
  };
}

describe('online-order acceptance IPC boundary', () => {
  it('registers a trusted main-process acceptance channel instead of placing from React', () => {
    const runtime = new OnlineOrderInboxIpcRuntime({ service: service() as never });
    runtime.register({ isDestroyed: () => false, webContents: { id: 77, send: vi.fn() } } as never);

    expect(electron.handlers.has('tux:online-orders:accept')).toBe(true);
    runtime.close();
  });
});
