import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ordersWorkspaceSource = readFileSync(new URL('./OrdersWorkspace.tsx', import.meta.url), 'utf8');

describe('unified menu edit entry point', () => {
  it('removes the standalone Manage order entry point while retaining the existing edit/search controls', () => {
    expect(ordersWorkspaceSource).not.toContain('Manage order');
    expect(ordersWorkspaceSource).not.toContain('category-manage-order-action');
    expect(ordersWorkspaceSource).toContain('EditPencilIcon');
    expect(ordersWorkspaceSource).toContain('SearchIcon');
  });
});
