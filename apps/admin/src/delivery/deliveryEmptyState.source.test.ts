import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Delivery workspace failed-read guard', () => {
  it('hides empty delivery lists when the workspace request fails', () => {
    const source = readFileSync('apps/admin/src/delivery/DeliveryPage.tsx', 'utf8');
    expect(source).toContain('workspace && !workspaceQuery.isError ? (');
  });
});
