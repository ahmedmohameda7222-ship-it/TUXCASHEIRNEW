import { EmptyState, ErrorState, LoadingState } from '../components/feedback/AdminStates';
import { PageScaffold } from '../components/layout/PageScaffold';
import { detailIdFromPath } from '../components/layout/detailRoute';
import { useShopScope } from '../shops/ShopScopeProvider';
import { useOperationsHealth } from './useOperationsHealth';
import './operations.css';

export function DeviceDetailPage() {
  const { scope } = useShopScope();
  const shopId = scope.kind === 'shop' ? scope.shopId : undefined;
  const deviceId = detailIdFromPath(window.location.pathname, '/devices');
  const query = useOperationsHealth(shopId, 'device', deviceId ?? undefined);
  const device = query.data?.view === 'device' ? query.data.device : undefined;
  return (
    <PageScaffold
      eyebrow="Device inventory"
      title={device?.label ?? 'Device detail'}
      description="Safe read-only device authority and configuration evidence."
      primaryAction={
        <a className="admin-secondary-button" href="/devices/list">
          Back to devices
        </a>
      }
    >
      {!shopId ? (
        <EmptyState
          title="Select a shop"
          description="Device detail requires one authorized shop."
        />
      ) : null}
      {!deviceId ? (
        <EmptyState
          title="Invalid device route"
          description="Return to the device list and choose a device."
        />
      ) : null}
      {query.isLoading ? <LoadingState title="Loading device" /> : null}
      {query.isError ? (
        <ErrorState
          title="Device unavailable"
          description="The device was not found in the selected authorized shop."
        />
      ) : null}
      {device ? (
        <div className="admin-operations-workspace">
          <dl className="admin-device-detail">
            <div>
              <dt>Authority state</dt>
              <dd>{device.sessionState}</dd>
            </div>
            <div>
              <dt>Revoked</dt>
              <dd>{device.revoked ? 'Yes' : 'No'}</dd>
            </div>
            <div>
              <dt>Configuration version</dt>
              <dd>{device.configVersion ?? 'Unavailable'}</dd>
            </div>
            <div>
              <dt>Last observed event</dt>
              <dd>
                {device.lastSeenAt
                  ? new Date(device.lastSeenAt).toLocaleString()
                  : 'No event observed'}
              </dd>
            </div>
            <div>
              <dt>Device ID</dt>
              <dd>
                <code>{device.id}</code>
              </dd>
            </div>
          </dl>
          <section className="admin-device-controls" aria-labelledby="device-controls-title">
            <div>
              <h2 id="device-controls-title">Device controls</h2>
              <p>
                Controls stay disabled until an audited server authority, versioned command and
                device acknowledgment transport exist.
              </p>
            </div>
            <div>
              {(
                [
                  ['Rename', device.capabilities.canRename],
                  ['Revoke', device.capabilities.canRevoke],
                  ['Move shop', device.capabilities.canMoveShop],
                  ['Refresh config', device.capabilities.canRefreshConfig],
                  ['Test print', device.capabilities.canTestPrint],
                ] as const
              ).map(([label, enabled]) => (
                <button
                  className="admin-secondary-button"
                  type="button"
                  disabled={!enabled}
                  title={
                    !enabled ? 'Unavailable: no safe audited device command authority' : undefined
                  }
                  key={label}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </PageScaffold>
  );
}
