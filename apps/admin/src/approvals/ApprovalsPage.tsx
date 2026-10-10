import type { AdminApprovalStatus } from '@tux/admin-contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';

import { useAdminSession } from '../auth/useAdminSession';
import { EmptyState, ErrorState, LoadingState } from '../components/feedback/AdminStates';
import { PageScaffold } from '../components/layout/PageScaffold';
import { ResponsiveMasterDetail } from '../components/layout/ResponsiveMasterDetail';
import { detailIdFromPath, detailPath } from '../components/layout/detailRoute';
import { AdminApiError, adminFetch } from '../lib/adminApi';
import {
  ApprovalDetailView,
  approvalStatusLabel,
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

type ApprovalListResponse = { approvals: ApprovalApiModel[]; nextCursor?: string | null };
type StatusFilter = 'ALL' | AdminApprovalStatus;
type ApprovalDecisionState = { kind: ApprovalDecisionKind; requestId: string };

export function approvalDecisionErrorMessage(error: unknown): string | undefined {
  if (!error) return undefined;
  if (!(error instanceof AdminApiError)) return 'The decision could not be completed.';
  if (error.errorCode === 'self_approval_forbidden') {
    return 'A different authorized person must approve or reject this request.';
  }
  if (error.errorCode === 'approval_already_decided') {
    return 'This request has already been decided. Reload to see its current status.';
  }
  if (error.errorCode === 'approval_expired') {
    return 'This request has expired. Submit a new request if the action is still needed.';
  }
  if (error.errorCode.toLowerCase().includes('pin')) return 'The PIN was not accepted.';
  return 'The decision could not be completed. Reload and try again.';
}

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

export function approvalDetailPollInterval(status?: AdminApprovalStatus | 'EXPIRED'): number | false {
  return status === undefined ||
    status === 'PENDING' ||
    status === 'APPROVED' ||
    status === 'EXECUTING'
    ? 15_000
    : false;
}

export function ApprovalsPage() {
  const session = useAdminSession();
  const queryClient = useQueryClient();
  const [location, navigate] = useLocation();
  const selectedId = detailIdFromPath(location, '/approvals');
  const [status, setStatus] = useState<StatusFilter>('ALL');
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

  const detailQuery = useQuery({
    queryKey: ['admin', 'approvals', 'detail', selectedId],
    enabled: selectedId !== null,
    queryFn: () =>
      adminFetch<ApprovalListResponse>(
        `/api/admin/approvals?id=${encodeURIComponent(selectedId!)}`,
      ).then((response) => response.approvals[0] ?? null),
    refetchInterval: (query) =>
      approvalDetailPollInterval(query.state.data?.displayStatus ?? query.state.data?.status),
  });

  const approvals = useMemo(
    () => approvalsQuery.data?.pages.flatMap((page) => page.approvals) ?? [],
    [approvalsQuery.data],
  );
  const selected = detailQuery.data ?? null;

  useEffect(() => {
    if (!decision) return;
    if (decision.requestId !== selectedId) {
      setDecision(null);
      return;
    }
    if (!detailQuery.isLoading && !detailQuery.isFetching && selected === null) {
      setDecision(null);
    }
  }, [decision, detailQuery.isFetching, detailQuery.isLoading, selected, selectedId]);

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
      const approval =
        selected?.id === requestId
          ? selected
          : (approvals.find((row) => row.id === requestId) ?? null);
      if (!approval || approval.displayStatus === 'EXPIRED' || approval.canDecide === false) {
        throw new Error('approval_selection_not_actionable');
      }
      if (session.state.status !== 'authenticated') throw new Error('session_required');
      await adminFetch<{ ok: true; requestId: string; status: AdminApprovalStatus }>(
        '/api/admin/approvals',
        { method: 'POST', body: JSON.stringify({ requestId, decision: kind, pin, reason }) },
        session.state.session.csrfToken,
      );
    },
    onSuccess: async () => {
      setDecision(null);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'approvals'] });
    },
  });

  const decisionError = approvalDecisionErrorMessage(decisionMutation.error);

  return (
    <PageScaffold
      eyebrow="Controls"
      title="Approvals"
      description="Review sensitive Admin requests with distinct-person approval and PIN confirmation."
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
            <option value="EXECUTING">In progress</option>
            <option value="EXECUTED">Completed</option>
            <option value="REJECTED">Rejected</option>
            <option value="FAILED">Needs attention</option>
          </select>
        </label>
      </div>

      <ResponsiveMasterDetail
        listLabel="Approval requests"
        detailLabel="Approval detail"
        detailActive={selectedId !== null}
        backHref="/approvals"
        list={
          <div className="admin-approval-list">
            {approvalsQuery.isLoading ? <LoadingState title="Loading approvals" /> : null}
            {approvalsQuery.isError ? (
              <ErrorState
                title="Approvals could not be loaded"
                action={
                  <button
                    className="admin-secondary-button"
                    type="button"
                    onClick={() => void approvalsQuery.refetch()}
                  >
                    Retry
                  </button>
                }
              />
            ) : null}
            {!approvalsQuery.isLoading && !approvalsQuery.isError && approvals.length === 0 ? (
              <EmptyState
                title="No approval requests"
                description="No requests match this status filter."
              />
            ) : null}
            {approvals.map((approval) => (
              <button
                className="admin-approval-list__item"
                aria-current={approval.id === selectedId ? 'true' : undefined}
                key={approval.id}
                type="button"
                onClick={() => {
                  setDecision(null);
                  navigate(detailPath('/approvals', approval.id));
                }}
              >
                <strong>{approval.actionLabel}</strong>
                <span>{approval.requesterName}</span>
                <span>{approval.shopName}</span>
                <span>{approvalStatusLabel(approval.displayStatus ?? approval.status)}</span>
              </button>
            ))}
            {approvalsQuery.hasNextPage ? (
              <button
                className="admin-secondary-button"
                type="button"
                disabled={approvalsQuery.isFetchingNextPage}
                onClick={() => void approvalsQuery.fetchNextPage()}
              >
                {approvalsQuery.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </button>
            ) : null}
          </div>
        }
        detail={
          detailQuery.isLoading ? (
            <LoadingState title="Loading approval" />
          ) : detailQuery.isError ? (
            <ErrorState
              title="Approval unavailable"
              description="This request may not exist or may not be visible in your authorized scope."
            />
          ) : selected ? (
            <ApprovalDetailView
              approval={toViewModel(selected)}
              deciding={decisionMutation.isPending}
              onApprove={() => setDecision({ kind: 'APPROVE', requestId: selected.id })}
              onReject={() => setDecision({ kind: 'REJECT', requestId: selected.id })}
            />
          ) : (
            <EmptyState
              title="Approval unavailable"
              description="Choose another request from the list."
            />
          )
        }
        emptyDetail={
          <EmptyState
            title="Select an approval"
            description="Review the request, reason and consequences before deciding."
          />
        }
      />

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
