import type { ComponentHealth, HealthState } from '@tux/admin-contracts';

import { EmptyState, ErrorState, LoadingState } from '../components/feedback/AdminStates';
import { PageScaffold } from '../components/layout/PageScaffold';
import { useShopScope } from '../shops/ShopScopeProvider';
import { useOperationsHealth } from './useOperationsHealth';
import './operations.css';

const LABELS: Record<ComponentHealth['key'], string> = {
  DEVICES: 'Devices', SYNC: 'Sync', BUSINESS_DAY: 'Business day', ONLINE_ORDERS: 'Online orders', PRINTERS: 'Printers', WHATSAPP: 'WhatsApp',
};

function stateLabel(state: HealthState): string {
  return state.split('_').map((part) => part.charAt(0) + part.slice(1).toLowerCase()).join(' ');
}

export function ShopHealthPage() {
  const { scope } = useShopScope();
  const shopId = scope.kind === 'shop' ? scope.shopId : undefined;
  const query = useOperationsHealth(shopId, 'summary');
  const health = query.data?.view === 'summary' ? query.data.health : undefined;
  return (
    <PageScaffold
      eyebrow="Operations monitoring"
      title="Operations health"
      description="Canonical device, business-day and channel signals for the selected shop. Unknown never means healthy."
      primaryAction={shopId ? <button className="admin-secondary-button" type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>{query.isFetching ? 'Refreshing…' : 'Refresh'}</button> : null}
    >
      {!shopId ? <EmptyState title="Select a shop" description="Operations health requires one authorized shop." /> : null}
      {query.isLoading ? <LoadingState title="Loading operations health" /> : null}
      {query.isError ? <ErrorState title="Operations health unavailable" description="No inferred green status is shown while source data is unavailable." action={<button className="admin-secondary-button" type="button" onClick={() => void query.refetch()}>Retry</button>} /> : null}
      {health ? (
        <div className="admin-operations-workspace">
          <section className="admin-health-hero">
            <div><span>Overall state</span><strong className={`admin-health-state admin-health-state--${health.overall.toLowerCase()}`}>{stateLabel(health.overall)}</strong></div>
            <div><span>{health.shopName}</span><time dateTime={health.asOf}>As of {new Date(health.asOf).toLocaleString()}</time></div>
          </section>
          <nav className="admin-operations-links" aria-label="Operations tools">
            <a className="admin-secondary-button" href="/devices/list">Browse devices</a>
            <a className="admin-secondary-button" href="/devices/printers">Printers</a>
            <a className="admin-secondary-button" href="/devices/opening-closing">Opening & closing</a>
            <a className="admin-secondary-button" href="/devices/manager-log">Manager log</a>
          </nav>
          <div className="admin-health-grid">
            {health.components.map((component) => (
              <article className="admin-health-card" key={component.key}>
                <div><h2>{LABELS[component.key]}</h2><span className={`admin-health-state admin-health-state--${component.state.toLowerCase()}`}>{stateLabel(component.state)}</span></div>
                <p>{component.reason}</p>
                {component.observedAt ? <time dateTime={component.observedAt}>Observed {new Date(component.observedAt).toLocaleString()}</time> : <span className="admin-health-card__unknown">No observation timestamp</span>}
                {component.href ? <a href={component.href}>Open source area</a> : null}
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </PageScaffold>
  );
}
