import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
  displayStatus: AdminApprovalStatus | 'EXPIRED';
  canDecide: boolean;
  executionLabel: string;
  failureMessage?: string;
  recoveryMessage?: string;
  expiresAt: string;
  createdAt: string;
  decidedAt: string | null;
};

type ApprovalListResponse = {
  approvals: ApprovalApiModel[];
  nextCursor?: string | null;
};
type StatusFilter = 'ALL' | AdminApprovalStatus;
type ApprovalDecisionState = { kind: ApprovalDecisionKind; requestId: string };

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
    displayStatus: approval.displayStatus,
    canDecide: approval.canDecide,
    executionLabel: approval.executionLabel,
    expiresAtLabel: formatInstant(approval.expiresAt),
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
  const [decision, setDecision] = useState<ApprovalDecisionState | null>(null);

  const approvalsQuery = useInfiniteQuery({
    queryKey: ['admin', 'approvals', status],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (status !== 'ALL') params.set('status', status);
      if (pageParam) params.set('cursor', pageParam);
      const suffix = params.size === 0 ? '' : `?${params.toString()}`;
      return adminFetch<ApprovalListResponse>(`/api/admin/approvals${suffix}`);
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchInterval: 15_000,
  });

  const approvals = useMemo(
    () => approvalsQuery.data?.pages.flatMap((page) => page.approvals) ?? [],
    [approvalsQuery.data],
  );

  useEffect(() => {
    if (approvals.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !approvals.some((row) => row.id === selectedId)) {
      setSelectedId(approvals[0]?.id ?? null);
    }
  }, [approvals, selectedId]);

  const selected = useMemo(
    () => approvals.find((row) => row.id === selectedId) ?? null,
    [approvals, selectedId],
  );

  const decisionMutation = useMutation({
    mutationFn: async ({
      kind,
      requestId,
      pin,
      reason,
    }: {
      kind: ApprovalDecisionKind;
      requestId: string;
      pin: string;
      reason: string | null;
    }) => {
      const approval = approvals.find((row) => row.id === requestId);
      if (!approval || approval.displayStatus === 'EXPIRED' || approval.canDecide === false) {
        throw new Error('approval_selection_not_actionable');
      }
      if (session.state.status !== 'authenticated') throw new Error('session_required');
      await adminFetch<{ ok: true; requestId: string; status: AdminApprovalStatus }>(
        '/api/admin/approvals',
        {
          method: 'POST',
          body: JSON.stringify({ requestId, decision: kind, pin, reason }),
        },
        session.state.session.csrfToken,
      );
    },
    onSuccess: async () => {
      setDecision(null);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'approvals'] });
    },
  });

  useEffect(() => {
    if (!decision) return;
    const approval = approvals.find((row) => row.id === decision.requestId);
    if (
      !approval ||
      approval.displayStatus === 'EXPIRED' ||
      approval.canDecide === false ||
      selectedId !== decision.requestId
    ) {
      setDecision(null);
    }
  }, [approvals, decision, selectedId]);

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
      {!approvalsQuery.isLoading && approvals.length === 0 ? (
        <p>No approval requests match this filter.</p>
      ) : null}
      <div className="admin-approvals-layout">
        <nav className="admin-approval-list" aria-label="Approval requests">
          {approvals.map((approval) => (
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
              <span>{approval.displayStatus ?? approval.status}</span>
            </button>
          ))}
          {approvalsQuery.hasNextPage ? (
            <button
              className="admin-approval-list__item"
              type="button"
              disabled={approvalsQuery.isFetchingNextPage}
              onClick={() => void approvalsQuery.fetchNextPage()}
            >
              {approvalsQuery.isFetchingNextPage
                ? 'Loading more approvals…'
                : 'Load more approvals'}
            </button>
          ) : null}
        </nav>
        {selected ? (
          <ApprovalDetailView
            approval={toViewModel(selected)}
            deciding={decisionMutation.isPending}
            onApprove={() => setDecision({ kind: 'APPROVE', requestId: selected.id })}
            onReject={() => setDecision({ kind: 'REJECT', requestId: selected.id })}
          />
        ) : null}
      </div>
      {decision ? (
        <RePinDialog
          decision={decision.kind}
          busy={decisionMutation.isPending}
          {...(decisionError ? { error: decisionError } : {})}
          onCancel={() => setDecision(null)}
          onConfirm={(pin, reason) =>
            decisionMutation.mutateAsync({
              kind: decision.kind,
              requestId: decision.requestId,
              pin,
              reason,
            })
          }
        />
      ) : null}
    </PageScaffold>
  );
}
