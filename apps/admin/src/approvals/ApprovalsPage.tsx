import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminApprovalStatus } from '@tux/admin-contracts';
import { useEffect, useMemo, useState } from 'react';

import { useAdminSession } from '../auth/useAdminSession';
import { PageScaffold } from '../components/layout/PageScaffold';
import { AdminApiError, adminFetch } from '../lib/adminApi';
import {
  ApprovalDetailView,
  type ApprovalDecisionKind,
  type ApprovalDetailViewModel,
} from './ApprovalDetailPage';
import { RePinDialog } from './RePinDialog';
import './approvals.css';

type ApprovalApiModel = {
  id: string;
  requesterName: string;
  requesterEmployeeId: string;
  approverName: string | null;
  shopId: string | null;
  shopName: string;
  actionLabel: string;
  valueSummary: string;
  reason: string | null;
  consequence: string;
  status: AdminApprovalStatus;
  executionLabel: string;
  failureMessage?: string;
  recoveryMessage?: string;
  createdAt: string;
  decidedAt: string | null;
};

type ApprovalListResponse = { approvals: ApprovalApiModel[] };
type StatusFilter = 'ALL' | AdminApprovalStatus;

function formatInstant(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function toViewModel(approval: ApprovalApiModel): ApprovalDetailViewModel {
  return {
    id: approval.id,
    requesterName: approval.requesterName,
    requesterEmployeeId: approval.requesterEmployeeId,
    approverName: approval.approverName,
    shopId: approval.shopId,
    shopName: approval.shopName,
    actionLabel: approval.actionLabel,
    amountOrValue: approval.valueSummary,
    reason: approval.reason,
    consequence: approval.consequence,
    status: approval.status,
    executionLabel: approval.executionLabel,
    createdAtLabel: formatInstant(approval.createdAt),
    decidedAtLabel: formatInstant(approval.decidedAt),
    ...(approval.failureMessage ? { failureMessage: approval.failureMessage } : {}),
    ...(approval.recoveryMessage ? { recoveryMessage: approval.recoveryMessage } : {}),
  };
}

export function ApprovalsPage() {
  const session = useAdminSession();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [decision, setDecision] = useState<ApprovalDecisionKind | null>(null);

  const approvalsQuery = useQuery({
    queryKey: ['admin', 'approvals', status],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (status !== 'ALL') params.set('status', status);
      const suffix = params.size === 0 ? '' : `?${params.toString()}`;
      return adminFetch<ApprovalListResponse>(`/api/admin/approvals${suffix}`);
    },
    refetchInterval: 15_000,
  });

  useEffect(() => {
    const rows = approvalsQuery.data?.approvals ?? [];
    if (rows.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !rows.some((row) => row.id === selectedId))
      setSelectedId(rows[0]?.id ?? null);
  }, [approvalsQuery.data, selectedId]);

  const selected = useMemo(
    () => approvalsQuery.data?.approvals.find((row) => row.id === selectedId) ?? null,
    [approvalsQuery.data, selectedId],
  );

  const decisionMutation = useMutation({
    mutationFn: async ({
      kind,
      pin,
      reason,
    }: {
      kind: ApprovalDecisionKind;
      pin: string;
      reason: string | null;
    }) => {
      if (!selected) throw new Error('approval_selection_required');
      if (session.state.status !== 'authenticated') throw new Error('session_required');
      await adminFetch<{ ok: true; requestId: string; status: AdminApprovalStatus }>(
        '/api/admin/approvals',
        {
          method: 'POST',
          body: JSON.stringify({ requestId: selected.id, decision: kind, pin, reason }),
        },
        session.state.session.csrfToken,
      );
    },
    onSuccess: async () => {
      setDecision(null);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'approvals'] });
    },
  });

  const decisionError =
    decisionMutation.error instanceof AdminApiError
      ? decisionMutation.error.errorCode.replaceAll('_', ' ')
      : decisionMutation.error
        ? 'The decision could not be completed.'
        : undefined;

  return (
    <PageScaffold
      eyebrow="Controls"
      title="Approvals"
      description="Review sensitive Admin commands. Approval is always a distinct-person, PIN-confirmed action."
    >
      <div className="admin-approvals-toolbar">
        <label className="admin-field">
          <span>Status</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.currentTarget.value as StatusFilter)}
          >
            <option value="ALL">All</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="EXECUTING">Executing</option>
            <option value="EXECUTED">Executed</option>
            <option value="REJECTED">Rejected</option>
            <option value="FAILED">Failed</option>
          </select>
        </label>
      </div>
      {approvalsQuery.isLoading ? <p>Loading approvals…</p> : null}
      {approvalsQuery.isError ? (
        <p className="admin-error-text">Approvals could not be loaded.</p>
      ) : null}
      {!approvalsQuery.isLoading && (approvalsQuery.data?.approvals.length ?? 0) === 0 ? (
        <p>No approval requests match this filter.</p>
      ) : null}
      <div className="admin-approvals-layout">
        <nav className="admin-approval-list" aria-label="Approval requests">
          {(approvalsQuery.data?.approvals ?? []).map((approval) => (
            <button
              className="admin-approval-list__item"
              aria-current={approval.id === selectedId ? 'true' : undefined}
              key={approval.id}
              type="button"
              onClick={() => setSelectedId(approval.id)}
            >
              <strong>{approval.actionLabel}</strong>
              <span>{approval.requesterName}</span>
              <span>{approval.shopName}</span>
              <span>{approval.status}</span>
            </button>
          ))}
        </nav>
        {selected ? (
          <ApprovalDetailView
            approval={toViewModel(selected)}
            deciding={decisionMutation.isPending}
            onApprove={() => setDecision('APPROVE')}
            onReject={() => setDecision('REJECT')}
          />
        ) : null}
      </div>
      {decision ? (
        <RePinDialog
          decision={decision}
          busy={decisionMutation.isPending}
          {...(decisionError ? { error: decisionError } : {})}
          onCancel={() => setDecision(null)}
          onConfirm={(pin, reason) => decisionMutation.mutateAsync({ kind: decision, pin, reason })}
        />
      ) : null}
    </PageScaffold>
  );
}
