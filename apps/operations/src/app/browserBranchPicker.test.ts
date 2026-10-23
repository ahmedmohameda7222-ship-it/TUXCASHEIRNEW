import { afterEach, describe, expect, it, vi } from 'vitest';
import { VercelBrowserRemoteGateway } from './browserRemote';
import { readFileSync } from 'node:fs';

const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';
const gate = readFileSync(new URL('./BrowserBootstrapGate.tsx', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../../../admin/src/operations/DevicesPage.tsx', import.meta.url), 'utf8');

afterEach(() => vi.unstubAllGlobals());

describe('first-browser branch and PIN entry', () => {
  it('renders a branch-name dropdown before the PIN without worker-facing shop IDs', () => {
    expect(gate).toContain('<label htmlFor="bootstrap-branch">Branch</label>');
    expect(gate).toContain('<select');
    expect(gate.indexOf('id="bootstrap-branch"')).toBeLessThan(gate.indexOf('id="bootstrap-worker-pin"'));
    expect(gate).toContain('{shop.name}');
    expect(gate).not.toContain('Shop ID (from TUX Admin)');
    expect(gate).not.toContain('Paste the Shop ID');
    expect(admin).not.toContain('Shop ID for Operations browser setup');
  });

  it('uses a stable distinct device per branch on the same browser', async () => {
    const stored = new Map<string, string>();
    vi.stubGlobal('window', {
      location: { hostname: 'ops.example', origin: 'https://ops.example' },
      localStorage: {
        getItem(key: string) { return stored.get(key) ?? null; },
        setItem(key: string, value: string) { stored.set(key, value); },
      },
    });
    const requests: Array<Record<string, string>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)) as Record<string, string>);
      return new Response(JSON.stringify({ error: 'invalid_pin' }), { status: 401 });
    }));
    const gateway = new VercelBrowserRemoteGateway();
    await expect(gateway.bootstrap('1234', A)).rejects.toThrow();
    await expect(gateway.bootstrap('1234', B)).rejects.toThrow();
    await expect(gateway.bootstrap('1234', A)).rejects.toThrow();
    expect(requests.map((r) => r.shopId)).toEqual([A, B, A]);
    expect(requests[0]?.deviceId).toBe(requests[2]?.deviceId);
    expect(requests[0]?.deviceId).not.toBe(requests[1]?.deviceId);
    expect(stored.size).toBe(2);
  });
});
