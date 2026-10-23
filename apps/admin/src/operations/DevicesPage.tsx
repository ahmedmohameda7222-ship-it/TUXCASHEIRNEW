import { useMemo, useState } from 'react';

import { EmptyState, ErrorState, LoadingState } from '../components/feedback/AdminStates';
import { PageScaffold } from '../components/layout/PageScaffold';
import { useShopScope } from '../shops/ShopScopeProvider';
import { useOperationsHealth } from './useOperationsHealth';
import './operations.css';

export function DevicesPage() {
  const { scope } = useShopScope();
  const shopId = scope.kind === 'shop' ? scope.shopId : undefined;
  const [search, setSearch] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const query = useOperationsHealth(shopId, 'devices');
  const devices = query.data?.view === 'devices' ? query.data.devices : [];
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return needle
      ? devices.filter((device) =>
          `${device.label} ${device.id}`.toLocaleLowerCase().includes(needle),
        )
      : devices;
  }, [devices, search]);
  return (
    <PageScaffold
      eyebrow="Operations monitoring"
      title="Devices"
      description="Server-authoritative enrolled devices. Last seen is evidence, not a guarantee that a device is online."
      primaryAction={
        <a className="admin-secondary-button" href="/devices">
          Health overview
        </a>
      }
    >
      {!shopId ? (
        <EmptyState
          title="Select a shop"
          description="Device inventory requires one authorized shop."
        />
      ) : (
        <div className="admin-operations-workspace">
          <div className="admin-device-enrollment-context">
            <strong>Shop ID for Operations browser setup</strong>
            <p>Share this Shop ID with a worker enrolling a new Operations browser. Their PIN is still required.</p>
            <code>{shopId}</code>
            <button
              type="button"
              className="admin-secondary-button"
              onClick={() => {
                void navigator.clipboard.writeText(shopId).then(
                  () => setCopyMessage('Shop ID copied.'),
                  () => setCopyMessage('Select the Shop ID above to copy it.'),
                );
              }}
            >
              Copy Shop ID
            </button>
            {copyMessage ? <span role="status">{copyMessage}</span> : null}
          </div>
          <label className="admin-field admin-device-search">
            <span>Search devices</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder="Label or device ID"
            />
          </label>
          {query.isLoading ? <LoadingState title="Loading devices" /> : null}
          {query.isError ? (
            <ErrorState
              title="Devices unavailable"
              description="No device counts are shown while the authorized source is unavailable."
            />
          ) : null}
          {!query.isLoading && !query.isError && filtered.length === 0 ? (
            <EmptyState
              title="No matching devices"
              description={
                devices.length
                  ? 'Try a different search.'
                  : 'No devices are enrolled for this shop.'
              }
            />
          ) : null}
          <div className="admin-device-list">
            {filtered.map((device) => (
              <a
                className="admin-device-row"
                href={`/devices/${encodeURIComponent(device.id)}`}
                key={device.id}
              >
                <div>
                  <strong>{device.label}</strong>
                  <code>{device.id}</code>
                </div>
                <div>
                  <span
                    className={`admin-health-state admin-health-state--${device.sessionState.toLowerCase()}`}
                  >
                    {device.sessionState.toLowerCase()}
                  </span>
                  <span>
                    {device.lastSeenAt
                      ? `Last event ${new Date(device.lastSeenAt).toLocaleString()}`
                      : 'No observed event'}
                  </span>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </PageScaffold>
  );
}
