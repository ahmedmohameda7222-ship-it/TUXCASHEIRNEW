import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Delivery workspace failed-read guard', () => {
  it(
    'does not render empty-success zone and order lists while the workspace request is in error',
    () => {
      const source = readFileSync('apps/admin/src/delivery/DeliveryPage.tsx', 'utf8');
      expect(source).toContain('workspace && !workspaceQuery.isError ? (');
    },
  );
});
