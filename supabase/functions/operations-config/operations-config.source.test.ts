import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

describe('operations-config authorization and read path', () => {
  it('overlaps independent JWT identity and RLS-protected device reads without skipping either check', () => {
    expect(source).toContain('const [userResult, deviceResult] = await Promise.all([');
    expect(source).toContain('client.auth.getUser(token)');
    expect(source).toContain(".from('devices')");
    expect(source).toContain("if (userError || !userData.user) return jsonResponse(401");
    expect(source).toContain("if (!device) return jsonResponse(403");
  });

  it('retains version and snapshot reads behind confirmed device authentication', () => {
    expect(source.indexOf('if (!device) return jsonResponse(403')).toBeLessThan(
      source.indexOf(".from('operations_configuration_snapshots')"),
    );
  });
});
