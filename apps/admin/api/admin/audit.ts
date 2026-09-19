import type { AdminApprovalStatus } from '@tux/admin-contracts';
import { z } from 'zod';

import { AdminAuthError, loadAdminSession } from '../../server/adminAuthService.js';
import {
  listAuditActorOptions,
  listAuditReadPage,
  type AuditReadCursor,
} from '../../server/audit/auditReadService.js';
import { AdminAuthorizationError, requirePermission } from '../../server/authorization.js';
import { getAdminServerEnv } from '../../server/env.js';
import { firstHeader, sendJson, type AdminRequest, type AdminResponse } from '../../server/http.js';
import { readAdminSessionToken } from '../../server/session.js';
import { AdminSupabaseClient, AdminSupabaseError } from '../../server/supabaseAdmin.js';

const uuidSchema = z.string().uuid();
const textFilterSchema = z.string().trim().min(1).max(160);
const instantSchema = z.string().datetime({ offset: true });
const auditCursorSchema = z
  .object({
    createdAt: instantSchema,
    id: uuidSchema,
  })
  .strict();
const approvalStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXECUTING',
  'EXECUTED',
  'FAILED',
]);

export function encodeAuditCursor(cursor: AuditReadCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function shouldLoadAuditActorOptions(cursor: AuditReadCursor | null | undefined): boolean {
  return cursor == null;
}

export function decodeAuditCursor(value: string): AuditReadCursor | null {
  if (value.length === 0 || value.length > 512) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    const parsed = auditCursorSchema.safeParse(decoded);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
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
    console.error('Admin audit database request failed', { status: error.status });
    sendJson(response, 502, { error: 'admin_backend_unavailable' });
    return;
  }
  console.error('Admin audit request failed');
  sendJson(response, 500, { error: 'admin_request_failed' });
}

export default async function handler(
  request: AdminRequest,
  response: AdminResponse,
): Promise<void> {
  if (request.method !== 'GET') {
    response.setHeader('allow', 'GET');
    sendJson(response, 405, { error: 'method_not_allowed' });
    return;
  }

  try {
    const client = new AdminSupabaseClient(getAdminServerEnv());
    const token = readAdminSessionToken(firstHeader(request.headers.cookie));
    if (!token) throw new AdminAuthError('session_required', 401);
    const context = await loadAdminSession(token, client);
    const requestUrl = new URL(request.url ?? '/', 'http://admin.local');
    const rawShopId = requestUrl.searchParams.get('shopId');
    const rawCursor = requestUrl.searchParams.get('cursor');
    const shopId = rawShopId === null ? undefined : uuidSchema.parse(rawShopId);
    const cursor = rawCursor === null ? undefined : decodeAuditCursor(rawCursor);
    if (rawCursor !== null && cursor === null) {
      sendJson(response, 400, { error: 'invalid_audit_cursor' });
      return;
    }
    requirePermission(context.principal, 'audit.view', shopId);

    const parseOptional = <T>(value: string | null, schema: z.ZodType<T>): T | undefined =>
      value === null ? undefined : schema.parse(value);
    const actorEmployeeId = parseOptional(
      requestUrl.searchParams.get('actorEmployeeId'),
      uuidSchema,
    );
    const actionType = parseOptional(requestUrl.searchParams.get('actionType'), textFilterSchema);
    const entityType = parseOptional(requestUrl.searchParams.get('entityType'), textFilterSchema);
    const approvalStatus = parseOptional(
      requestUrl.searchParams.get('approvalStatus'),
      approvalStatusSchema,
    ) as AdminApprovalStatus | undefined;
    const from = parseOptional(requestUrl.searchParams.get('from'), instantSchema);
    const to = parseOptional(requestUrl.searchParams.get('to'), instantSchema);

    const [page, actorOptions] = await Promise.all([
      listAuditReadPage(client, context.principal, {
        ...(shopId ? { shopId } : {}),
        ...(actorEmployeeId ? { actorEmployeeId } : {}),
        ...(actionType ? { actionType } : {}),
        ...(entityType ? { entityType } : {}),
        ...(approvalStatus ? { approvalStatus } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(cursor ? { cursor } : {}),
      }),
      shouldLoadAuditActorOptions(cursor)
        ? listAuditActorOptions(client, context.principal)
        : Promise.resolve([]),
    ]);
    sendJson(response, 200, {
      events: page.events,
      actorOptions,
      nextCursor: page.nextCursor ? encodeAuditCursor(page.nextCursor) : null,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      sendJson(response, 400, { error: 'invalid_audit_request' });
      return;
    }
    handleFailure(response, error);
  }
}
