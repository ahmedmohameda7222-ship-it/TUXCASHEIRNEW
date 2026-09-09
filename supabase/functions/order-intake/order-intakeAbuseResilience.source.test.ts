import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('online-order anonymous intake abuse resilience', () => {
  it('uses a gateway-derived client fingerprint and expires stale pending spam', () => {
    const migrationPath = resolve(
      process.cwd(),
      'supabase/migrations/20260908056000_online_order_intake_abuse_resilience.sql',
    );
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migration = readFileSync(migrationPath, 'utf8');
    const edge = readFileSync(
      resolve(process.cwd(), 'supabase/functions/order-intake/order-intake.ts'),
      'utf8',
    );

    expect(migration).toContain('source_fingerprint');
    expect(migration).toContain('TUX_ONLINE_ORDER_INTAKE_SOURCE_RATE_LIMITED');
    expect(migration).toMatch(/status\s*=\s*'PENDING'[\s\S]*created_at\s*</i);
    expect(migration).toMatch(/set\s+status\s*=\s*'REJECTED'[\s\S]*resolved_at\s*=\s*v_now/i);
    expect(migration).not.toContain('v_active_count >= 150');
    expect(edge).toContain('sourceFingerprint');
    expect(edge).toContain("x-forwarded-for");
  });
});
