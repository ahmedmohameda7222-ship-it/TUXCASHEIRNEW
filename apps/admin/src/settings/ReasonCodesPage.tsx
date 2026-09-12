import type {
  AdminReasonCodeConfiguration,
  AdminReasonFamily,
  AdminSettingsWorkspace,
} from '@tux/admin-contracts';
import { useState, type FormEvent } from 'react';

import type { ReasonCodeUpdateDraft } from './useSettings';

const families: readonly AdminReasonFamily[] = [
  'CANCELLATION',
  'REFUND_RETURN',
  'DISCOUNT_COMP',
  'WASTE',
  'STOCK_ADJUSTMENT',
  'CASH_VARIANCE',
  'PAY_IN',
  'PAY_OUT',
];

type ReasonCodesPageProps = {
  workspace: AdminSettingsWorkspace;
  onUpsert(draft: ReasonCodeUpdateDraft): void | Promise<void>;
  updating: boolean;
};

function EditableReasonCode({
  reason,
  onUpsert,
  updating,
}: {
  reason: AdminReasonCodeConfiguration;
  onUpsert(draft: ReasonCodeUpdateDraft): void | Promise<void>;
  updating: boolean;
}) {
  const [label, setLabel] = useState(reason.label);
  const [active, setActive] = useState(reason.active);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onUpsert({
      reasonCodeId: reason.id,
      key: reason.key,
      family: reason.family,
      label: label.trim(),
      active,
      expectedVersion: reason.version,
    });
  }

  return (
    <form
      className="admin-catalog-editor__section is-compact"
      data-reason-code-id={reason.id}
      data-reason-code-version={reason.version}
      onSubmit={(event) => void submit(event)}
    >
      <div className="admin-catalog-editor__section-heading">
        <div>
          <p className="admin-catalog-editor__eyebrow">{reason.family}</p>
          <h3>{reason.key}</h3>
        </div>
        <span className={active ? 'admin-status-pill' : 'admin-status-pill is-muted'}>
          {active ? 'Active' : 'Inactive'}
        </span>
      </div>
      <label className="admin-field">
        <span>Reason label</span>
        <input
          aria-label={`${reason.key} reason label`}
          value={label}
          maxLength={240}
          disabled={updating}
          onChange={(event) => setLabel(event.target.value)}
        />
      </label>
      <label className="admin-field">
        <span>Status</span>
        <select
          aria-label={`${reason.key} reason status`}
          value={active ? 'active' : 'inactive'}
          disabled={updating}
          onChange={(event) => setActive(event.target.value === 'active')}
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </label>
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
      <button className="admin-secondary-button" type="submit" disabled={updating || !label.trim()}>
        {updating ? 'Saving…' : `Save ${reason.key}`}
      </button>
    </form>
  );
}

function InheritedReasonCode({ reason }: { reason: AdminReasonCodeConfiguration }) {
  return (
    <article
      className="admin-catalog-editor__section is-compact"
      data-reason-code-id={reason.id}
      data-reason-code-version={reason.version}
    >
      <div className="admin-catalog-editor__section-heading">
        <div>
          <p className="admin-catalog-editor__eyebrow">{reason.family} · Business default</p>
          <h3>{reason.label}</h3>
        </div>
        <span className={reason.active ? 'admin-status-pill' : 'admin-status-pill is-muted'}>
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
      <p className="admin-field__help">
        Business-level reason identity is inherited here and cannot be reclassified from one shop.
      </p>
    </article>
  );
}

function NewReasonCode({
  onUpsert,
  updating,
}: Pick<ReasonCodesPageProps, 'onUpsert' | 'updating'>) {
  const [key, setKey] = useState('');
  const [family, setFamily] = useState<AdminReasonFamily>('CANCELLATION');
  const [label, setLabel] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onUpsert({
      reasonCodeId: null,
      key: key.trim().toLowerCase(),
      family,
      label: label.trim(),
      active: true,
      expectedVersion: null,
    });
    setKey('');
    setLabel('');
  }

  return (
    <form className="admin-catalog-editor__section" onSubmit={(event) => void submit(event)}>
      <div className="admin-catalog-editor__section-heading">
        <div>
          <p className="admin-catalog-editor__eyebrow">Shop reason</p>
          <h3>Add reason code</h3>
        </div>
      </div>
      <label className="admin-field">
        <span>Stable key</span>
        <input
          aria-label="New reason stable key"
          value={key}
          maxLength={120}
          pattern="[a-z][a-z0-9_-]*"
          placeholder="customer_changed_mind"
          disabled={updating}
          onChange={(event) => setKey(event.target.value.toLowerCase())}
        />
      </label>
      <label className="admin-field">
        <span>Family</span>
        <select
          aria-label="New reason family"
          value={family}
          disabled={updating}
          onChange={(event) => setFamily(event.target.value as AdminReasonFamily)}
        >
          {families.map((candidate) => (
            <option key={candidate} value={candidate}>
              {candidate}
            </option>
          ))}
        </select>
      </label>
      <label className="admin-field">
        <span>Label</span>
        <input
          aria-label="New reason label"
          value={label}
          maxLength={240}
          disabled={updating}
          onChange={(event) => setLabel(event.target.value)}
        />
      </label>
      <button
        className="admin-primary-button"
        type="submit"
        disabled={updating || !key.trim() || !label.trim()}
      >
        {updating ? 'Saving…' : 'Add reason code'}
      </button>
    </form>
  );
}

export function ReasonCodesPage({ workspace, onUpsert, updating }: ReasonCodesPageProps) {
  return (
    <section className="admin-settings-reasons" aria-labelledby="settings-reasons-heading">
      <div className="admin-catalog-editor__section-heading">
        <div>
          <p className="admin-catalog-editor__eyebrow">Reason codes</p>
          <h2 id="settings-reasons-heading">Configured operational reasons</h2>
        </div>
      </div>
      <p className="admin-field__help">
        Operational actions persist the configured reason identity and version. Stable keys and
        families are immutable after creation; deactivate a code instead of deleting history.
      </p>

      <NewReasonCode onUpsert={onUpsert} updating={updating} />

      {workspace.reasonCodes.length === 0 ? (
        <p className="admin-field__help">No reason codes configured.</p>
      ) : (
        <div className="admin-settings-reasons__list">
          {workspace.reasonCodes.map((reason) =>
            reason.scope === 'SHOP' ? (
              <EditableReasonCode
                key={reason.id}
                reason={reason}
                onUpsert={onUpsert}
                updating={updating}
              />
            ) : (
              <InheritedReasonCode key={reason.id} reason={reason} />
            ),
          )}
        </div>
      )}
    </section>
  );
}
