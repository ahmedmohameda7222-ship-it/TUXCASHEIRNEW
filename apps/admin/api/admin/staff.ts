import type { StaffCommandResult } from '@tux/admin-contracts';
import { z } from 'zod';

import {
  AdminAuthError,
  loadAdminSession,
  requireSessionCsrf,
  type AdminSessionContext,
} from '../../server/adminAuthService.js';
import { AdminAuthorizationError } from '../../server/authorization.js';
import { getAdminServerEnv } from '../../server/env.js';
import {
  firstHeader,
  readJsonObject,
  requireSameOrigin,
  sendJson,
  type AdminRequest,
  type AdminResponse,
} from '../../server/http.js';
import { readAdminSessionToken } from '../../server/session.js';
import {
  createStaffService,
  createSupabaseStaffStore,
  StaffServiceError,
} from '../../server/staff/staffService.js';
import { AdminSupabaseClient, AdminSupabaseError } from '../../server/supabaseAdmin.js';

const uuidSchema = z.string().uuid();
const commandIdSchema = z.string().trim().min(1).max(160);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoTimestampSchema = z.string().datetime({ offset: true });
const nullableTextSchema = z.string().trim().max(500).nullable();

const commandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('attendance.correct'),
      attendanceEventId: uuidSchema,
      shopId: uuidSchema,
      correctedOccurredAt: isoTimestampSchema,
      reason: z.string().trim().min(1).max(500),
      commandId: commandIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('payment.record'),
      employeeId: uuidSchema,
      shopId: uuidSchema,
      payPeriodStart: isoDateSchema,
      payPeriodEnd: isoDateSchema,
      expectedAmountMinor: z.number().int().safe().nonnegative(),
      paidAmountMinor: z.number().int().safe().positive(),
      financeAccountId: uuidSchema,
      paymentDate: isoDateSchema,
      note: nullableTextSchema,
      reference: z.string().trim().max(240).nullable(),
      commandId: commandIdSchema,
    })
    .strict(),
]);

async function loadContext(
  request: AdminRequest,
  client: AdminSupabaseClient,
): Promise<AdminSessionContext> {
  const token = readAdminSessionToken(firstHeader(request.headers.cookie));
  if (!token) throw new AdminAuthError('session_required', 401);
  const context = await loadAdminSession(token, client);
  requireSessionCsrf(context, firstHeader(request.headers['x-tux-admin-csrf']).trim());
  return context;
}

function failureStatus(result: StaffCommandResult): number {
  if (result.ok) return 200;
  if (result.code.includes('stale') || result.code.includes('conflict')) return 409;
  if (result.code.includes('forbidden') || result.code.includes('permission')) return 403;
  if (result.code.includes('not_found') || result.code.includes('missing')) return 404;
  return 400;
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
  if (error instanceof StaffServiceError) {
    sendJson(response, 400, { error: error.code });
    return;
  }
  if (error instanceof z.ZodError) {
    sendJson(response, 400, { error: 'invalid_staff_request' });
    return;
  }
  if (error instanceof AdminSupabaseError) {
    console.error('Admin Workforce database request failed', { status: error.status });
    sendJson(response, 502, { error: 'admin_backend_unavailable' });
    return;
  }
  console.error('Admin Workforce request failed');
  sendJson(response, 500, { error: 'admin_request_failed' });
}

export default async function handler(
  request: AdminRequest,
  response: AdminResponse,
): Promise<void> {
  if (request.method !== 'POST') {
    response.setHeader('allow', 'POST');
    sendJson(response, 405, { error: 'method_not_allowed' });
    return;
  }

  try {
    if (!requireSameOrigin(request, response)) return;

    const command = commandSchema.parse(await readJsonObject(request));
    const client = new AdminSupabaseClient(getAdminServerEnv());
    const context = await loadContext(request, client);
    const service = createStaffService(createSupabaseStaffStore(client));

    let result: StaffCommandResult;
    switch (command.type) {
      case 'attendance.correct':
        result = await service.correctAttendance(command, context.principal);
        break;
      case 'payment.record':
        result = await service.recordPayment(command, context.principal);
        break;
    }

    sendJson(response, failureStatus(result), result);
  } catch (error) {
    handleFailure(response, error);
  }
}
