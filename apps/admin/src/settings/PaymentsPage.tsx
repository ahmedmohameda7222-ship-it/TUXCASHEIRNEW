import type { AdminSettingsWorkspace } from '@tux/admin-contracts';

export function PaymentsPage({ workspace }: { workspace: AdminSettingsWorkspace }) {
  return (
    <section className="admin-settings-section" aria-labelledby="settings-payments-title">
      <div className="admin-settings-section__header">
        <div>
          <p className="admin-settings-kicker">Channel-safe tender configuration</p>
          <h2 id="settings-payments-title">Payments</h2>
        </div>
        <span className="admin-status-pill">{workspace.paymentMethods.length} methods</span>
      </div>
      <div className="admin-settings-list">
        {workspace.paymentMethods.map((method) => (
          <div className="admin-settings-row admin-settings-row--stack" key={method.id}>
            <div className="admin-settings-row__main">
              <div>
                <strong>{method.displayName}</strong>
                <span>
                  {method.logicType} · {method.channel}
                </span>
              </div>
              <span className={method.active ? 'admin-status-pill' : 'admin-status-pill is-muted'}>
                {method.active ? 'Active' : 'Inactive'}
              </span>
            </div>
            <div className="admin-settings-tags">
              {method.requiresReference ? <span>Reference required</span> : null}
              {method.manualConfirmationRequired ? <span>Manual confirmation</span> : null}
              {method.requiresReconciliation ? <span>Reconciled</span> : null}
              <span>{method.refundAllowed ? 'Refund allowed' : 'No refund'}</span>
              {method.integrationReference ? <span>{method.integrationReference}</span> : null}
            </div>
          </div>
        ))}
      </div>
      <p className="admin-settings-muted">
        Online checkout only receives active methods whose channel is ONLINE or BOTH.
      </p>
    </section>
  );
}
