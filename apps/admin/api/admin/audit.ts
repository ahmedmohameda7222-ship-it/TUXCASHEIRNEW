import type { AdminApprovalStatus } from '@tux/admin-contracts';
import { z } from 'zod';

import { AdminAuthError, loadAdminSession } from '../../server/adminAuthService';
import {
  listAuditActorOptions,
  listAuditReadModels,
} from '../../server/audit/auditReadService';
import { AdminAuthorizationError, requirePermission } from '../../server/authorization';
import { getAdminServerEnv } from '../../server/env';
import { firstHeader, sendJson, type AdminRequest, type AdminResponse } from '../../server/http';
import { readAdminSessionToken } from '../../server/session';
import { AdminSupabaseClient, AdminSupabaseError } from '../../server/supabaseAdmin';

const uuidSchema = z.string().uuid();
const textFilterSchema = z.string().trim().min(1).max(160);
const instantSchema = z.string().datetime({ offset: true });
const approvalStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXECUTING',
  'EXECUTED',
  'FAILED',
]);

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
    const shopId = rawShopId === null ? undefined : uuidSchema.parse(rawShopId);
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

    const [events, actorOptions] = await Promise.all([
      listAuditReadModels(client, context.principal, {
        ...(shopId ? { shopId } : {}),
        ...(actorEmployeeId ? { actorEmployeeId } : {}),
        ...(actionType ? { actionType } : {}),
        ...(entityType ? { entityType } : {}),
        ...(approvalStatus ? { approvalStatus } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      }),
      listAuditActorOptions(client, context.principal),
    ]);
    sendJson(response, 200, { events, actorOptions });
  } catch (error) {
    if (error instanceof z.ZodError) {
      sendJson(response, 400, { error: 'invalid_audit_request' });
      return;
    }
    handleFailure(response, error);
  }
}
