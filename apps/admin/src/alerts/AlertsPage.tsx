import { useEffect, useMemo, useRef, useState } from 'react';
import type { AdminAlert, AlertSeverity, AlertSource } from '@tux/admin-contracts';

import { EmptyState, ErrorState, LoadingState } from '../components/feedback/AdminStates';
import { PageScaffold } from '../components/layout/PageScaffold';
import { useShopScope } from '../shops/ShopScopeProvider';
import { DEFAULT_ALERT_FILTERS, useAlerts, type AlertsFilters } from './useAlerts';
import './alerts.css';

const SAFE_SOURCE_LINKS: Record<AlertSource, { href: string; label: string }> = {
  APPROVAL: { href: '/approvals', label: 'Approvals' },
  INVENTORY: { href: '/inventory', label: 'Inventory' },
  DELIVERY: { href: '/delivery', label: 'Delivery' },
  OPERATIONS: { href: '/devices', label: 'Operations' },
  WHATSAPP: { href: '/whatsapp', label: 'WhatsApp' },
};

function relativeObservation(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return 'Observation time unavailable';
  const deltaMinutes = Math.round((timestamp - Date.now()) / 60_000);
  if (Math.abs(deltaMinutes) < 1) return 'Observed just now';
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (Math.abs(deltaMinutes) < 60) return `Observed ${formatter.format(deltaMinutes, 'minute')}`;
  const deltaHours = Math.round(deltaMinutes / 60);
  if (Math.abs(deltaHours) < 24) return `Observed ${formatter.format(deltaHours, 'hour')}`;
  return `Observed ${formatter.format(Math.round(deltaHours / 24), 'day')}`;
}

function sourceUnavailableLabel(source: AlertSource): string {
  return `${source.charAt(0)}${source.slice(1).toLowerCase()} data is unavailable`;
}

function AlertCard({ alert }: { alert: AdminAlert }) {
  const destination = SAFE_SOURCE_LINKS[alert.source];
  return (
    <article className="admin-alert-card">
      <div className="admin-alert-card__badges">
        <span className={`admin-alert-badge admin-alert-badge--${alert.severity.toLowerCase()}`}>
          {alert.severity.charAt(0) + alert.severity.slice(1).toLowerCase()}
        </span>
        <span className="admin-alert-badge admin-alert-badge--source">
          {alert.source.charAt(0) + alert.source.slice(1).toLowerCase()}
        </span>
      </div>
      <div className="admin-alert-card__content">
        <p className="admin-alert-card__shop">{alert.shopName}</p>
        <h2>{alert.title}</h2>
        <p>{alert.description}</p>
        <time dateTime={alert.observedAt}>{relativeObservation(alert.observedAt)}</time>
      </div>
      <a className="admin-secondary-button admin-alert-card__action" href={destination.href}>
        Open {destination.label}
      </a>
    </article>
  );
}

export function AlertsPage() {
  const { scope } = useShopScope();
  const shopId = scope.kind === 'shop' ? scope.shopId : undefined;
  const [filters, setFilters] = useState<AlertsFilters>(DEFAULT_ALERT_FILTERS);
  const previousShopId = useRef(shopId);
  const query = useAlerts(shopId, filters);

  useEffect(() => {
    if (previousShopId.current !== shopId) setFilters(DEFAULT_ALERT_FILTERS);
    previousShopId.current = shopId;
  }, [shopId]);

  const countLabel = useMemo(() => {
    const count = query.data?.rows.length ?? 0;
    return `${count} authorized alert${count === 1 ? '' : 's'}`;
  }, [query.data?.rows.length]);

  return (
    <PageScaffold
      eyebrow="Monitoring"
      title="Alerts"
      description="Source-backed issues that need attention in the selected shop."
      primaryAction={
        shopId ? (
          <button
            className="admin-secondary-button"
            type="button"
            aria-label="Refresh alerts"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {query.isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        ) : null
      }
    >
      {!shopId ? (
        <EmptyState
          title="Select a shop"
          description="Alerts require one authorized shop. Choose a shop from the header to continue."
        />
      ) : (
        <div className="admin-alerts-workspace">
          <header className="admin-alerts-summary">
            <div>
              <strong>{query.data?.scopeLabel ?? 'Selected shop'}</strong>
              <span>{countLabel}</span>
            </div>
            <span>
              {query.data?.asOf
                ? `Refreshed ${new Date(query.data.asOf).toLocaleString()}`
                : 'Waiting for current data'}
            </span>
          </header>

          <div className="admin-alerts-filters" aria-label="Alert filters">
            <label className="admin-field">
              <span>Source</span>
              <select
                value={filters.source}
                onChange={(event) => {
                  const source = event.currentTarget.value as AlertSource | 'ALL';
                  setFilters((current) => ({
                    ...current,
                    source,
                  }));
                }}
              >
                <option value="ALL">All sources</option>
                <option value="APPROVAL">Approval</option>
                <option value="INVENTORY">Inventory</option>
                <option value="DELIVERY">Delivery</option>
                <option value="OPERATIONS">Operations</option>
                <option value="WHATSAPP">WhatsApp</option>
              </select>
            </label>
            <label className="admin-field">
              <span>Severity</span>
              <select
                value={filters.severity}
                onChange={(event) => {
                  const severity = event.currentTarget.value as AlertSeverity | 'ALL';
                  setFilters((current) => ({
                    ...current,
                    severity,
                  }));
                }}
              >
                <option value="ALL">All severities</option>
                <option value="CRITICAL">Critical</option>
                <option value="WARNING">Warning</option>
                <option value="INFO">Info</option>
              </select>
            </label>
            <label className="admin-field">
              <span>State</span>
              <select
                value={filters.state}
                onChange={(event) => {
                  const state = event.currentTarget.value as AlertsFilters['state'];
                  setFilters((current) => ({
                    ...current,
                    state,
                  }));
                }}
              >
                <option value="ACTIVE">Active</option>
                <option value="RESOLVED">Resolved</option>
                <option value="ALL">All states</option>
              </select>
            </label>
          </div>

          {query.isLoading ? <LoadingState title="Loading alerts" /> : null}
          {query.isError ? (
            <ErrorState
              title="Alerts could not be loaded"
              description="No alert counts or details are shown for this shop."
              action={
                <button
                  className="admin-secondary-button"
                  type="button"
                  onClick={() => void query.refetch()}
                >
                  Retry
                </button>
              }
            />
          ) : null}

          {!query.isLoading && !query.isError && query.data?.unavailableSources.length ? (
            <div className="admin-alerts-source-warning" role="alert">
              <strong>Some alert sources could not be checked.</strong>
              <span>
                {query.data.unavailableSources.map(sourceUnavailableLabel).join(' · ')}. Try refresh
                before treating this list as healthy.
              </span>
            </div>
          ) : null}

          {!query.isLoading &&
          !query.isError &&
          query.data?.rows.length === 0 &&
          query.data.unavailableSources.length === 0 ? (
            <EmptyState
              title="No actionable alerts"
              description="No authorized source reports an actionable issue for these filters."
            />
          ) : null}

          {query.data?.rows.length ? (
            <div className="admin-alert-list" aria-label="Authorized alerts">
              {query.data.rows.map((alert) => (
                <AlertCard alert={alert} key={alert.id} />
              ))}
            </div>
          ) : null}
        </div>
      )}
    </PageScaffold>
  );
}
