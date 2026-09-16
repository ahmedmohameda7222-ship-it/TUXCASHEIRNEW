import type { AdminApprovalActor, AdminApprovalStatus } from '@tux/admin-contracts';
import { z } from 'zod';

import {
  AdminAuthError,
  loadAdminSession,
  requireSessionCsrf,
  type AdminSessionContext,
} from '../../server/adminAuthService';
import {
  approveRequest,
  createSupabaseApprovalServiceDependencies,
  rejectRequest,
} from '../../server/approvals/approvalService';
import { listApprovalReadModels } from '../../server/approvals/approvalReadService';
import { AdminAuthorizationError, requirePermission } from '../../server/authorization';
import { getAdminServerEnv } from '../../server/env';
import {
  firstHeader,
  readJsonObject,
  requireSameOrigin,
  sendJson,
  type AdminRequest,
  type AdminResponse,
} from '../../server/http';
import { readAdminSessionToken } from '../../server/session';
import { AdminSupabaseClient, AdminSupabaseError } from '../../server/supabaseAdmin';

const uuidSchema = z.string().uuid();
const statusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'EXECUTING', 'EXECUTED', 'FAILED']);
const decisionSchema = z
  .object({
    requestId: uuidSchema,
    decision: z.enum(['APPROVE', 'REJECT']),
    pin: z.string().min(1).max(128),
    reason: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export function requireApprovalEndpointAccess(
  context: AdminSessionContext,
  shopId?: string,
): void {
  requirePermission(context.principal, 'approvals.review', shopId);
}

export function buildApprovalActor(context: AdminSessionContext): AdminApprovalActor {
  return {
    employeeId: context.principal.employeeId,
    businessId: context.principal.businessId,
    role: context.principal.role,
    permissions: context.principal.permissions,
    shopIds: context.principal.shopIds,
    sessionId: context.session.id,
  };
}

export function parseApprovalDecisionBody(body: unknown): z.infer<typeof decisionSchema> | null {
  const parsed = decisionSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

async function loadContext(
  request: AdminRequest,
  client: AdminSupabaseClient,
  csrfRequired: boolean,
): Promise<AdminSessionContext> {
  const token = readAdminSessionToken(firstHeader(request.headers.cookie));
  if (!token) throw new AdminAuthError('session_required', 401);
  const context = await loadAdminSession(token, client);
  if (csrfRequired) {
    requireSessionCsrf(context, firstHeader(request.headers['x-tux-admin-csrf']).trim());
  }
  return context;
}

function handleFailure(response: AdminResponse, error: unknown): void {
  if (error instanceof AdminAuthError) {
    sendJson(response, error.status, { error: error.code });
    return;
  }
  if (error instanceof AdminAuthorizationError) {
    sendJson(response, 403, { error: error.code });
    return;
  }
  if (error instanceof AdminSupabaseError) {
    console.error('Admin approvals database request failed', { status: error.status });
    sendJson(response, 502, { error: 'admin_backend_unavailable' });
    return;
  }
  console.error('Admin approvals request failed');
  sendJson(response, 500, { error: 'admin_request_failed' });
}

function decisionFailureStatus(code: string): number {
  if (code === 'approval_request_not_found') return 404;
  if (code === 'approval_already_decided' || code === 'approval_expired') return 409;
  if (
    code === 'invalid_pin' ||
    code === 'self_approval_forbidden' ||
    code === 'approver_not_authorized' ||
    code === 'approval_business_scope_forbidden' ||
    code === 'approval_shop_scope_forbidden'
  ) {
    return 403;
  }
  return 400;
}

export default async function handler(
  request: AdminRequest,
  response: AdminResponse,
): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'POST') {
    response.setHeader('allow', 'GET, POST');
    sendJson(response, 405, { error: 'method_not_allowed' });
    return;
  }

  try {
    const client = new AdminSupabaseClient(getAdminServerEnv());
    if (request.method === 'GET') {
      const requestUrl = new URL(request.url ?? '/', 'http://admin.local');
      const rawShopId = requestUrl.searchParams.get('shopId');
      const rawId = requestUrl.searchParams.get('id');
      const rawStatus = requestUrl.searchParams.get('status');
      const shopId = rawShopId === null ? undefined : uuidSchema.parse(rawShopId);
      const id = rawId === null ? undefined : uuidSchema.parse(rawId);
      const status =
        rawStatus === null ? undefined : (statusSchema.parse(rawStatus) as AdminApprovalStatus);
      const context = await loadContext(request, client, false);
      requireApprovalEndpointAccess(context, shopId);
      const approvals = await listApprovalReadModels(client, context.principal, {
        ...(id ? { id } : {}),
        ...(shopId ? { shopId } : {}),
        ...(status ? { status } : {}),
      });
      sendJson(response, 200, { approvals });
      return;
    }

    if (!requireSameOrigin(request, response)) return;
    const body = parseApprovalDecisionBody(await readJsonObject(request));
    if (!body) {
      sendJson(response, 400, { error: 'invalid_approval_decision' });
      return;
    }
    const context = await loadContext(request, client, true);
    requireApprovalEndpointAccess(context);
    const actor = buildApprovalActor(context);
    const deps = createSupabaseApprovalServiceDependencies(client);
    const result =
      body.decision === 'APPROVE'
        ? await approveRequest(
            { requestId: body.requestId, pin: body.pin, reason: body.reason ?? null },
            actor,
            deps,
          )
        : await rejectRequest(
            { requestId: body.requestId, pin: body.pin, reason: body.reason ?? null },
            actor,
            deps,
          );
    if (!result.ok) {
      sendJson(response, decisionFailureStatus(result.code), { error: result.code });
      return;
    }
    sendJson(response, 200, { ok: true, requestId: body.requestId, status: result.status });
  } catch (error) {
    if (error instanceof z.ZodError) {
      sendJson(response, 400, { error: 'invalid_approval_request' });
      return;
    }
    handleFailure(response, error);
  }
}
