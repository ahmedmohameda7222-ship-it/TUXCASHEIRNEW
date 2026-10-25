import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Operations session-exit deployment route', () => {
  it('exposes the session-exit proxy from the Operations Vercel project root', () => {
    const sharedRoute = resolve('api/operations-session-exit.ts');
    const operationsRoute = resolve('apps/operations/api/operations-session-exit.ts');

    expect(existsSync(sharedRoute)).toBe(true);
    expect(existsSync(operationsRoute)).toBe(true);
    if (!existsSync(operationsRoute)) return;

    expect(readFileSync(operationsRoute, 'utf8')).toContain(
      "export { default } from '../../../api/operations-session-exit.js';",
    );
  });
});
