import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('Hobby deployment API entrypoint budget', () => {
  it('fits no more than twelve Vercel serverless functions', () => {
    const entries = readdirSync(join(appRoot, 'api/admin')).filter((name) =>
      name.endsWith('.ts'),
    );
    expect(entries).toHaveLength(12);
  });

  it('routes the four correction commands through existing trusted server handlers', () => {
    const config = JSON.parse(readFileSync(join(appRoot, 'vercel.json'), 'utf8')) as {
      routes: Array<{ src?: string; dest?: string }>;
    };
    const required: Record<string, string> = {
      '/api/admin/shop-create': '/api/admin/settings?__adminResource=shop-create',
      '/api/admin/shop-copy-preview': '/api/admin/settings?__adminResource=shop-copy-preview',
      '/api/admin/payment-zone-rules': '/api/admin/settings?__adminResource=payment-zone-rules',
      '/api/admin/approval-rules': '/api/admin/approvals?__adminResource=approval-rules',
    };
    for (const [src, dest] of Object.entries(required)) {
      expect(config.routes).toContainEqual({ src, dest });
    }
  });
});
