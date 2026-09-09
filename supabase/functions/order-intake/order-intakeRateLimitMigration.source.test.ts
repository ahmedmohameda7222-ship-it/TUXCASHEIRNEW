import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('online-order intake database abuse bound', () => {
  it('enforces a serialized active-request capacity before inserts', () => {
    const migrationsDir = resolve(process.cwd(), 'supabase/migrations');
    const source = readdirSync(migrationsDir)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => readFileSync(resolve(migrationsDir, name), 'utf8'))
      .join('\n');

    expect(source).toContain('TUX_ONLINE_ORDER_INTAKE_CAPACITY_EXCEEDED');
    expect(source).toContain('pg_advisory_xact_lock');
    expect(source).toMatch(/status\s+in\s*\(\s*'PENDING'\s*,\s*'PROCESSING'\s*\)/i);
    expect(source).toContain('before insert on public.online_order_requests');
  });
});
