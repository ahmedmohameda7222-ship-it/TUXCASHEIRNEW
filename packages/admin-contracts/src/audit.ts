import type { AdminRole } from './auth';

export type AdminAuditActorKind = 'HUMAN' | 'SYSTEM';

export type AdminAuditEvent = {
  id: string;
  businessId: string;
  shopId: string | null;
  actorKind: AdminAuditActorKind;
  actorEmployeeId: string | null;
  actorRole: AdminRole | 'SYSTEM';
  requesterEmployeeId: string | null;
  approverEmployeeId: string | null;
  actionType: string;
  entityType: string | null;
  entityId: string | null;
  beforeValue: unknown;
  afterValue: unknown;
  reason: string | null;
  approvalRequestId: string | null;
  sessionId: string | null;
  contextMetadata: Readonly<Record<string, unknown>>;
  createdAt: string;
};

export type AppendAdminAuditEventInput = {
  businessId: string;
  shopId?: string | null;
  actorEmployeeId?: string | null;
  actionType: string;
  entityType?: string | null;
  entityId?: string | null;
  beforeValue?: unknown;
  afterValue?: unknown;
  reason?: string | null;
  approvalRequestId?: string | null;
  sessionId?: string | null;
  contextMetadata?: Readonly<Record<string, unknown>>;
};
