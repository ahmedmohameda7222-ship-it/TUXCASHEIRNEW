import { EmptyState } from '../components/feedback/AdminStates';
import { PageScaffold } from '../components/layout/PageScaffold';
import { useShopScope } from '../shops/ShopScopeProvider';
import './operations.css';

export function PrintersPage() {
  const { scope } = useShopScope();
  const shopId = scope.kind === 'shop' ? scope.shopId : undefined;
  return (
    <PageScaffold eyebrow="Operations monitoring" title="Printers" description="Honest receipt-printer configuration and transport status." primaryAction={<a className="admin-secondary-button" href="/devices">Health overview</a>}>
      {!shopId ? <EmptyState title="Select a shop" description="Printer status requires one authorized shop." /> : (
        <section className="admin-printer-status" aria-labelledby="printer-transport-title">
          <div><span className="admin-health-state admin-health-state--not_configured">Not configured</span><h2 id="printer-transport-title">Remote printer transport unavailable</h2><p>Desktop printing is local Electron IPC only. Admin has no provisioned, acknowledged route to a physical device.</p></div>
          <button className="admin-primary-button" type="button" disabled title="Unavailable: no safe device print transport">Send test print</button>
        </section>
      )}
    </PageScaffold>
  );
}
