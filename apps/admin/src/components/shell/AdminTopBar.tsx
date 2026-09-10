import { LogOut, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';

import type { AdminSessionPrincipal } from '@tux/admin-contracts';

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
        <span>{principal.role}</span>
      </div>
      <div className="admin-topbar__spacer" />
      {shopControl}
      <button className="admin-icon-button admin-topbar__logout" type="button" onClick={onLogout}>
        <LogOut size={18} aria-hidden="true" />
        <span>Log out</span>
      </button>
    </header>
  );
}
