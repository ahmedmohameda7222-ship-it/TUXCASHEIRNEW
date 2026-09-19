import type { AdminApprovalActor, AdminApprovalStatus } from '@tux/admin-contracts';
import { z } from 'zod';

import {
  AdminAuthError,
  loadAdminSession,
  requireSessionCsrf,
  type AdminSessionContext,
} from '../../server/adminAuthService.js';
import { verifyApprovalPinWithRateLimit } from '../../server/approvals/approvalPinRateLimit.js';
import {
  approveRequest,
  createSupabaseApprovalServiceDependencies,
  rejectRequest,
} from '../../server/approvals/approvalService.js';
import {
  listApprovalReadPage,
  type ApprovalReadCursor,
} from '../../server/approvals/approvalReadService.js';
import { AdminAuthorizationError, requirePermission } from '../../server/authorization.js';
import { getAdminServerEnv } from '../../server/env.js';
import {
  clientFingerprint,
  firstHeader,
  readJsonObject,
  requireSameOrigin,
  sendJson,
  type AdminRequest,
  type AdminResponse,
} from '../../server/http.js';
import { AdminRateLimitError, createAdminPinRateLimitRpc } from '../../server/loginRateLimit.js';
import { readAdminSessionToken } from '../../server/session.js';
import { AdminSupabaseClient, AdminSupabaseError } from '../../server/supabaseAdmin.js';

const uuidSchema = z.string().uuid();
const statusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'EXECUTING', 'EXECUTED', 'FAILED']);
const approvalCursorSchema = z
  .object({
    createdAt: z.string().datetime({ offset: true }),
    id: uuidSchema,
  })
  .strict();
const decisionSchema = z
  .object({
    requestId: uuidSchema,
    decision: z.enum(['APPROVE', 'REJECT']),
    pin: z.string().min(1).max(128),
    reason: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export function requireApprovalEndpointAccess(context: AdminSessionContext, shopId?: string): void {
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

export function encodeApprovalCursor(cursor: ApprovalReadCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeApprovalCursor(value: string): ApprovalReadCursor | null {
  if (value.length === 0 || value.length > 512) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    const parsed = approvalCursorSchema.safeParse(decoded);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
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
  if (error instanceof AdminRateLimitError) {
    response.setHeader('retry-after', String(error.retryAfterSeconds));
    sendJson(response, 429, { error: error.code });
    return;
  }
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
    const env = getAdminServerEnv();
    const client = new AdminSupabaseClient(env);
    if (request.method === 'GET') {
      const requestUrl = new URL(request.url ?? '/', 'http://admin.local');
      const rawShopId = requestUrl.searchParams.get('shopId');
      const rawId = requestUrl.searchParams.get('id');
      const rawStatus = requestUrl.searchParams.get('status');
      const rawCursor = requestUrl.searchParams.get('cursor');
      const shopId = rawShopId === null ? undefined : uuidSchema.parse(rawShopId);
      const id = rawId === null ? undefined : uuidSchema.parse(rawId);
      const status =
        rawStatus === null ? undefined : (statusSchema.parse(rawStatus) as AdminApprovalStatus);
      const cursor = rawCursor === null ? undefined : decodeApprovalCursor(rawCursor);
      if (rawCursor !== null && cursor === null) {
        sendJson(response, 400, { error: 'invalid_approval_cursor' });
        return;
      }
      const context = await loadContext(request, client, false);
      requireApprovalEndpointAccess(context, shopId);
      const page = await listApprovalReadPage(client, context.principal, {
        ...(id ? { id } : {}),
        ...(shopId ? { shopId } : {}),
        ...(status ? { status } : {}),
        ...(cursor ? { cursor } : {}),
      });
      sendJson(response, 200, {
        approvals: page.approvals,
        nextCursor: page.nextCursor ? encodeApprovalCursor(page.nextCursor) : null,
      });
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
    const baseDeps = createSupabaseApprovalServiceDependencies(client);
    const limiter = createAdminPinRateLimitRpc(client);
    const deps = {
      ...baseDeps,
      verifyEmployeePin(employeeId: string, pin: string) {
        return verifyApprovalPinWithRateLimit(
          {
            employeeId,
            sessionId: context.session.id,
            pin,
            fingerprint: clientFingerprint(request),
            rateLimitSecret: env.rateLimitSecret,
          },
          { verifyEmployeePin: baseDeps.verifyEmployeePin, limiter },
        );
      },
    };
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
