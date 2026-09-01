import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const proxyPath = resolve(process.cwd(), 'server/workerAuthenticationGateway.ts');
const apiPath = resolve(process.cwd(), 'api/worker-auth.ts');
const edgePath = resolve(process.cwd(), 'supabase/functions/worker-auth/index.ts');

describe('worker authentication backend authority', () => {
  it('has a dedicated Vercel proxy and Supabase Edge endpoint', () => {
    expect(existsSync(proxyPath)).toBe(true);
    expect(existsSync(apiPath)).toBe(true);
    expect(existsSync(edgePath)).toBe(true);
  });

  it('uses the existing authenticated device session without device enrollment or identity rotation', () => {
    if (!existsSync(proxyPath) || !existsSync(edgePath)) return;
    const proxy = readFileSync(proxyPath, 'utf8');
    const edge = readFileSync(edgePath, 'utf8');

    expect(proxy).toContain('requireDeviceSession');
    expect(proxy).toContain('/functions/v1/worker-auth');
    expect(proxy).not.toContain('/functions/v1/device-bootstrap');
    expect(edge).toContain("request.headers.get('authorization')");
    expect(edge).toContain("request.headers.get('x-tux-device-id')");
    expect(edge).not.toContain('auth.admin.createUser');
    expect(edge).not.toContain('auth.admin.updateUserById');
    expect(edge).not.toContain("from('devices').insert");
  });

  it('reuses the server-side PIN attempt limiter and only emits an explicit transport-unavailable proxy signal', () => {
    if (!existsSync(proxyPath) || !existsSync(edgePath)) return;
    const proxy = readFileSync(proxyPath, 'utf8');
    const edge = readFileSync(edgePath, 'utf8');

    expect(edge).toContain('claim_tux_worker_pin_bootstrap_attempt');
    expect(edge).toContain('clear_tux_worker_pin_bootstrap_attempts');
    expect(edge).toContain("jsonResponse(429, { error: 'too_many_pin_attempts' }");
    expect(proxy).toContain("sendJson(response, 503, { error: 'remote_backend_unavailable' })");
  });
});
