import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ordersWorkspaceSource = readFileSync(
  new URL('./OrdersWorkspace.tsx', import.meta.url),
  'utf8',
);

describe('unified menu edit entry point', () => {
  it('removes the standalone Manage order entry point while retaining the existing edit/search controls', () => {
    expect(ordersWorkspaceSource).not.toContain('Manage order');
    expect(ordersWorkspaceSource).not.toContain('category-manage-order-action');
    expect(ordersWorkspaceSource).toContain('EditPencilIcon');
    expect(ordersWorkspaceSource).toContain('SearchIcon');
  });

  it('uses Pencil to activate one pressed menu edit session and blocks Search during it', () => {
    expect(ordersWorkspaceSource).toContain('menuEditActive');
    expect(ordersWorkspaceSource).toContain('setMenuEditActive(true)');
    expect(ordersWorkspaceSource).toContain('aria-pressed={menuEditActive}');
    expect(ordersWorkspaceSource).toContain("if (menuEditActive) return;");
    expect(ordersWorkspaceSource).not.toContain("categoryMode === 'EDIT'");
  });
});
