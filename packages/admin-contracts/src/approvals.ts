import type { AdminPermission, AdminRole } from './auth';

export const ADMIN_APPROVAL_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXECUTING',
  'EXECUTED',
  'FAILED',
] as const;

export type AdminApprovalStatus = (typeof ADMIN_APPROVAL_STATUSES)[number];

export type AdminApprovalActor = {
  employeeId: string;
  businessId: string;
  role: AdminRole;
  permissions: AdminPermission[];
  shopIds: string[];
  sessionId: string;
};

export type AdminApprovalRule = {
  id: string;
  businessId: string;
  shopId: string | null;
  actionType: string;
  requesterPermission: AdminPermission;
  approverPermission: AdminPermission;
  requiresSecondPerson: boolean;
  requiresRequesterRepin: boolean;
  thresholdContext: Readonly<Record<string, unknown>>;
  active: boolean;
};

export type ApprovalDecision =
  | { required: false }
  | {
      required: true;
      ruleId: string;
      approverPermission: AdminPermission;
      requiresSecondPerson: boolean;
      requiresRequesterRepin: boolean;
    };

export type AdminApprovalRequestSummary = {
  id: string;
  businessId: string;
  shopId: string | null;
  requesterEmployeeId: string;
  approverEmployeeId?: string | null;
  actionType: string;
  commandId?: string;
  reason?: string | null;
  requiredApproverPermission: AdminPermission;
  requiresSecondPerson: boolean;
  status: AdminApprovalStatus;
  createdAt?: string;
  decidedAt?: string | null;
  executedAt?: string | null;
  failedAt?: string | null;
};

export type AdminApprovalExecutionState = 'READY' | 'CLAIMED' | 'RETRYABLE' | 'EXECUTED' | 'FAILED';

export type AdminApprovalExecutionClaim = {
  approvalRequestId: string;
  businessId: string;
  shopId: string | null;
  requesterEmployeeId: string;
  approverEmployeeId: string;
  actionType: string;
  commandId: string;
  commandPayload: Readonly<Record<string, unknown>>;
  claimToken: string;
  attemptCount: number;
  leaseExpiresAt: string;
};
