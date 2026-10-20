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
  displayStatus?: AdminApprovalStatus | 'EXPIRED';
  canDecide?: boolean;
  executionLabel: string;
  failureMessage?: string;
  recoveryMessage?: string;
  expiresAtLabel?: string | null;
  createdAtLabel: string;
  decidedAtLabel?: string | null;
};

export function approvalDecisionDialogTitle(decision: ApprovalDecisionKind): string {
  return decision === 'APPROVE' ? 'Enter PIN to approve' : 'Enter PIN to reject';
}

export function approvalStatusLabel(status: AdminApprovalStatus | 'EXPIRED'): string {
  const labels: Record<AdminApprovalStatus | 'EXPIRED', string> = {
    PENDING: 'Pending',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    EXECUTING: 'In progress',
    EXECUTED: 'Completed',
    FAILED: 'Needs attention',
    EXPIRED: 'Expired',
  };
  return labels[status];
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
  const displayStatus = approval.displayStatus ?? approval.status;
  const canDecide = approval.canDecide ?? approval.status === 'PENDING';

  return (
    <section className="admin-approval-detail" aria-labelledby={`approval-${approval.id}`}>
      <header className="admin-approval-detail__header">
        <div>
          <p className="admin-approval-detail__eyebrow">Approval request</p>
          <h2 id={`approval-${approval.id}`}>{approval.actionLabel}</h2>
        </div>
        <span
          className={`admin-approval-status admin-approval-status--${displayStatus.toLowerCase()}`}
        >
          {approvalStatusLabel(displayStatus)}
        </span>
      </header>
      <dl className="admin-approval-facts">
        <div>
          <dt>Shop</dt>
          <dd>{approval.shopName}</dd>
        </div>
        <div>
          <dt>Requester</dt>
          <dd>{approval.requesterName}</dd>
        </div>
        <div>
          <dt>Value</dt>
          <dd>{approval.amountOrValue}</dd>
        </div>
        <div>
          <dt>Requested</dt>
          <dd>{approval.createdAtLabel}</dd>
        </div>
        {approval.approverName ? (
          <div>
            <dt>Approver</dt>
            <dd>{approval.approverName}</dd>
          </div>
        ) : null}
        {approval.decidedAtLabel ? (
          <div>
            <dt>Decision time</dt>
            <dd>{approval.decidedAtLabel}</dd>
          </div>
        ) : null}
        {approval.expiresAtLabel ? (
          <div>
            <dt>Expires</dt>
            <dd>{approval.expiresAtLabel}</dd>
          </div>
        ) : null}
      </dl>
      <div className="admin-approval-detail__section">
        <strong>Reason for request</strong>
        <p>{approval.reason ?? 'No reason supplied.'}</p>
      </div>
      <div className="admin-approval-detail__section">
        <strong>Consequence</strong>
        <p>{approval.consequence}</p>
      </div>
      <div className="admin-approval-detail__section" aria-live="polite">
        <strong>Execution — separate from approval</strong>
        <p>{approval.executionLabel}</p>
        {approval.failureMessage ? (
          <p className="admin-error-text">{approval.failureMessage}</p>
        ) : null}
        {approval.recoveryMessage ? <p>{approval.recoveryMessage}</p> : null}
      </div>
      {canDecide ? (
        <div className="admin-approval-actions" aria-label="Authorized decisions">
          <button
            className="admin-primary-button"
            type="button"
            disabled={deciding}
            onClick={onApprove}
          >
            Approve
          </button>
          <button
            className="admin-destructive-button"
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
