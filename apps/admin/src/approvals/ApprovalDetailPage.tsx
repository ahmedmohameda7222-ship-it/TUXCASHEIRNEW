import type { AdminApprovalStatus } from '@tux/admin-contracts';

export type ApprovalDecisionKind = 'APPROVE' | 'REJECT';

export type ApprovalDetailViewModel = {
  id: string;
  requesterName: string;
  requesterEmployeeId?: string;
  approverName?: string | null;
  shopId?: string | null;
  shopName: string;
  actionLabel: string;
  amountOrValue: string;
  reason: string | null;
  consequence: string;
  status: AdminApprovalStatus;
  executionLabel: string;
  failureMessage?: string;
  recoveryMessage?: string;
  createdAtLabel: string;
  decidedAtLabel?: string | null;
};

export function approvalDecisionDialogTitle(decision: ApprovalDecisionKind): string {
  return decision === 'APPROVE' ? 'Enter PIN to approve' : 'Enter PIN to reject';
}

export function ApprovalDetailView({
  approval,
  deciding,
  onApprove,
  onReject,
}: {
  approval: ApprovalDetailViewModel;
  deciding: boolean;
  onApprove(): void;
  onReject(): void;
}) {
  const pending = approval.status === 'PENDING';
  return (
    <section className="admin-approval-detail" aria-labelledby={`approval-${approval.id}`}>
      <header className="admin-approval-detail__header">
        <div>
          <p className="admin-catalog-editor__eyebrow">Approval request</p>
          <h2 id={`approval-${approval.id}`}>{approval.actionLabel}</h2>
        </div>
        <span
          className={`admin-approval-status admin-approval-status--${approval.status.toLowerCase()}`}
        >
          {approval.status}
        </span>
      </header>
      <dl className="admin-approval-facts">
        <div>
          <dt>Requester</dt>
          <dd>{approval.requesterName}</dd>
        </div>
        <div>
          <dt>Shop</dt>
          <dd>{approval.shopName}</dd>
        </div>
        <div>
          <dt>Value</dt>
          <dd>{approval.amountOrValue}</dd>
        </div>
        <div>
          <dt>Requested</dt>
          <dd>{approval.createdAtLabel}</dd>
        </div>
      </dl>
      <div className="admin-approval-detail__section">
        <strong>Reason</strong>
        <p>{approval.reason ?? 'No reason supplied.'}</p>
      </div>
      <div className="admin-approval-detail__section">
        <strong>Consequence</strong>
        <p>{approval.consequence}</p>
      </div>
      <div className="admin-approval-detail__section" aria-live="polite">
        <strong>Execution</strong>
        <p>{approval.executionLabel}</p>
        {approval.failureMessage ? (
          <p className="admin-error-text">{approval.failureMessage}</p>
        ) : null}
        {approval.recoveryMessage ? <p>{approval.recoveryMessage}</p> : null}
      </div>
      {pending ? (
        <div className="admin-approval-actions">
          <button
            className="admin-primary-button"
            type="button"
            disabled={deciding}
            onClick={onApprove}
          >
            Approve
          </button>
          <button
            className="admin-secondary-button"
            type="button"
            disabled={deciding}
            onClick={onReject}
          >
            Reject
          </button>
        </div>
      ) : null}
    </section>
  );
}
