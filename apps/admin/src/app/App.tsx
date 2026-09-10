import { LoginPage } from '../auth/LoginPage';
import { AdminSessionProvider } from '../auth/AdminSessionProvider';
import { useAdminSession } from '../auth/useAdminSession';
import { ShopScopeProvider } from '../shops/ShopScopeProvider';
import { ShopSwitcher } from '../shops/ShopSwitcher';
import { AdminRoutes } from './routes';

function AdminAppContent() {
  const session = useAdminSession();
  if (session.state.status === 'loading') {
    return (
      <main className="admin-entry" aria-busy="true">
        <section className="admin-entry__card">
          <p className="admin-entry__eyebrow">TUX Admin</p>
          <h1>Loading…</h1>
        </section>
      </main>
    );
  }
  if (session.state.status === 'unauthenticated') return <LoginPage login={session.login} />;

  const principal = session.state.session.principal;
  return (
    <ShopScopeProvider principal={principal}>
      <div className="admin-authenticated">
        <header className="admin-context-bar">
          <strong>TUX Admin</strong>
          <ShopSwitcher />
          <button type="button" onClick={() => void session.logout()}>Log out</button>
        </header>
        <AdminRoutes principal={principal} />
      </div>
    </ShopScopeProvider>
  );
}

export default function App() {
  return (
    <AdminSessionProvider>
      <AdminAppContent />
    </AdminSessionProvider>
  );
}
