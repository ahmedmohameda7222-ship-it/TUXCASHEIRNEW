import type { AdminSettingsWorkspace } from '@tux/admin-contracts';

export function ReasonCodesPage({ workspace }: { workspace: AdminSettingsWorkspace }) {
  return (
    <section className="admin-settings-reasons" aria-labelledby="settings-reasons-heading">
      <div className="admin-catalog-editor__section-heading">
        <div>
          <p className="admin-catalog-editor__eyebrow">Reason codes</p>
          <h2 id="settings-reasons-heading">Configured operational reasons</h2>
        </div>
      </div>
      <p className="admin-field__help">
        Operational actions persist the configured reason identity and version; labels are display
        text, not the durable authority.
      </p>

      {workspace.reasonCodes.length === 0 ? (
        <p className="admin-field__help">No reason codes configured.</p>
      ) : (
        <div className="admin-settings-reasons__list">
          {workspace.reasonCodes.map((reason) => (
            <article
              className="admin-catalog-editor__section is-compact"
              key={reason.id}
              data-reason-code-id={reason.id}
              data-reason-code-version={reason.version}
            >
              <div className="admin-catalog-editor__section-heading">
                <div>
                  <p className="admin-catalog-editor__eyebrow">{reason.family}</p>
                  <h3>{reason.label}</h3>
                </div>
                <span
                  className={reason.active ? 'admin-status-pill' : 'admin-status-pill is-muted'}
                >
                  {reason.active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <dl>
                <div>
                  <dt>Stable key</dt>
                  <dd>{reason.key}</dd>
                </div>
                <div>
                  <dt>Scope</dt>
                  <dd>{reason.scope}</dd>
                </div>
                <div>
                  <dt>Version</dt>
                  <dd>v{reason.version}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
