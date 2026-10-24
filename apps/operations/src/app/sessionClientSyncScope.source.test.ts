import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./sessionClient.ts', import.meta.url), 'utf8');

describe('Operations shop-scoped background sync lifecycle', () => {
  it('stops the old shop sync and configuration poll before starting a newly authenticated shop', () => {
    expect(source).toContain('activeSyncShopId !== shopId');
    expect(source).toContain('automaticSyncHandle?.stop()');
    expect(source).toContain('window.clearInterval(configurationTimer)');
    expect(source).toContain('activeSyncShopId = shopId;');
  });

  it('restarts the right shop sync if an authenticated state recovers after a transient failure', () => {
    expect(source).toContain("if (result.ok && result.value.status === 'ACTIVE') {");
    expect(source).toContain('startRemoteRuntime(result.value.shopId);');
  });

  it('attempts durable worker sign-out delivery before stopping remote sync', () => {
    const section = source.slice(source.indexOf('const signOut = async'), source.indexOf('if (preferenceRetryStarted'));
    const flush = section.indexOf('await flushShopOutbox(');
    const stop = section.indexOf('stopRemoteRuntime();');
    expect(flush).toBeGreaterThanOrEqual(0);
    expect(stop).toBeGreaterThan(flush);
  });

  it('stops the background sync at sign out and when a stale server session is fenced', () => {
    expect(source).toContain('const stopRemoteRuntime = (): void => {');
    expect(source).toContain('stopRemoteRuntime();');
    expect(source).toContain('} else {\n          stopRemoteRuntime();\n        }');
  });
});
