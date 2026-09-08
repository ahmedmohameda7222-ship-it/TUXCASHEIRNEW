import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'apps/operations-desktop/src/main/index.ts'),
  'utf8',
);

describe('Electron online-order inbox composition', () => {
  it('composes the cached inbox service with the authenticated Operations remote gateway', () => {
    expect(source).toContain('OperationsOnlineOrderInboxService');
    expect(source).toContain('OnlineOrderInboxRemoteGateway');
    expect(source).toContain('SqliteOnlineOrderInboxStore');
    expect(source).toContain('SupabaseDesktopOnlineOrderOperationsRemote');
    expect(source).toContain('new OperationsOnlineOrderInboxService({');
    expect(source).toContain('getActiveShopId: resolveOnlineOrderInboxShopId');
  });

  it('keeps remote unavailability non-blocking and wires the narrow IPC runtime lifecycle', () => {
    expect(source).toContain('unavailableOnlineOrderInboxRemote');
    expect(source).toContain(
      'new OnlineOrderInboxIpcRuntime({ service: onlineOrderInboxService })',
    );
    expect(source).toContain('onlineOrderInboxIpcRuntime.register(window)');
    expect(source).toContain('onlineOrderInboxIpcRuntime?.close()');
    expect(source).toContain('void onlineOrderInboxStore?.close()');
  });
});
