import { LogOut, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';

import type { AdminSessionPrincipal } from '@tux/admin-contracts';

function roleLabel(role: AdminSessionPrincipal['role']): string {
  return role === 'OWNER'
    ? 'Owner'
    : role === 'ADMIN'
      ? 'Administrator'
      : role === 'MANAGER'
        ? 'Manager'
        : 'Staff';
}

export function AdminTopBar({
  principal,
  shopControl,
  onLogout,
}: {
  principal: AdminSessionPrincipal;
  shopControl?: ReactNode;
  onLogout(): void;
}) {
  return (
    <header className="admin-topbar">
      <div className="admin-topbar__mobile-brand">
        <span className="admin-sidebar__mark">T</span>
        <strong>TUX Admin</strong>
      </div>
      <div className="admin-topbar__context">
        <ShieldCheck size={17} aria-hidden="true" />
        <span>{roleLabel(principal.role)}</span>
      </div>
      <div className="admin-topbar__spacer" />
      {shopControl}
      <button
        className="admin-icon-button admin-topbar__logout"
        type="button"
        aria-label="Log out"
        onClick={onLogout}
      >
        <LogOut size={18} aria-hidden="true" />
        <span aria-hidden="true">Log out</span>
      </button>
    </header>
  );
}
