import type { TuxSyncHealthSnapshot } from '@tux/platform-contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const synced: TuxSyncHealthSnapshot = {
  state: 'SYNCED',
  label: 'Synced',
  remoteConfigured: true,
  attentionRequired: false,
};

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('window', { addEventListener: vi.fn() });
  harness.exposed = null;
  await import('./index');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

type SyncApi = {
  readonly getStatus: () => Promise<TuxSyncHealthSnapshot>;
  readonly subscribe: (listener: (snapshot: TuxSyncHealthSnapshot) => void) => () => void;
};

function syncApi(): SyncApi {
  return (harness.exposed as { readonly sync?: SyncApi }).sync as SyncApi;
}

describe('desktop sync status preload bridge', () => {
  it('validates getStatus and notification payloads through explicit channels', async () => {
    harness.invoke.mockResolvedValue(synced);

    expect(await syncApi().getStatus()).toEqual(synced);
    expect(harness.invoke).toHaveBeenCalledWith('tux:sync:get-status');

    const listener = vi.fn();
    const unsubscribe = syncApi().subscribe(listener);
    expect(harness.on).toHaveBeenCalledTimes(1);
    expect(harness.on.mock.calls[0]?.[0]).toBe('tux:sync:status-changed');

    const wrapper = harness.on.mock.calls[0]?.[1] as (_event: unknown, value: unknown) => void;
    wrapper({}, synced);
    expect(listener).toHaveBeenCalledWith(synced);
    expect(() => wrapper({}, { state: 'ONLINE' })).toThrow(TypeError);

    unsubscribe();
    expect(harness.removeListener).toHaveBeenCalledWith('tux:sync:status-changed', wrapper);
  });
});
