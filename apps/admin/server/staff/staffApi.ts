import type { AdminApprovalActor, AdminPermission, StaffCommandResult } from '@tux/admin-contracts';
import { z } from 'zod';

import {
  AdminAuthError,
  loadAdminSession,
  requireSessionCsrf,
  type AdminSessionContext,
} from '../adminAuthService.js';
import { isAdminPermission } from '../adminContractRuntime.js';
import { verifyApprovalPinWithRateLimit } from '../approvals/approvalPinRateLimit.js';
import { createSupabaseApprovalServiceDependencies } from '../approvals/approvalService.js';
import {
  AdminAuthorizationError,
  requireBusinessWidePermission,
  requirePermission,
} from '../authorization.js';
import { getAdminServerEnv } from '../env.js';
import {
  clientFingerprint,
  firstHeader,
  readJsonObject,
  requireSameOrigin,
  sendJson,
  type AdminRequest,
  type AdminResponse,
} from '../http.js';
import { AdminRecentReauthError, requireRecentReauth } from '../reauth.js';
import { createAdminPinRateLimitRpc } from '../loginRateLimit.js';
import { readAdminSessionToken } from '../session.js';
import { prepareEmployeePinChange } from './employeePin.js';
import { createSupabaseEmployeePinStore } from './employeePinStore.js';
import {
  EMPLOYEE_PERMISSION_CHANGE_APPROVAL_ACTION,
  EMPLOYEE_PIN_CHANGE_APPROVAL_ACTION,
  EMPLOYEE_ROLE_CHANGE_APPROVAL_ACTION,
  EMPLOYEE_SUSPEND_APPROVAL_ACTION,
  STAFF_PAYMENT_APPROVAL_ACTION,
} from './staffApproval.js';
import { executeOrRequestStaffApproval } from './staffApprovalRouting.js';
import { createStaffService, createSupabaseStaffStore, StaffServiceError } from './staffService.js';
import { AdminSupabaseClient, AdminSupabaseError } from '../supabaseAdmin.js';

const uuidSchema = z.string().uuid();
const commandIdSchema = z.string().uuid();
export const staffPinSchema = z.string().regex(/^\d{4,12}$/);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoTimestampSchema = z.string().datetime({ offset: true });
const nullableTextSchema = z.string().trim().max(500).nullable();
const roleSchema = z.enum(['OWNER', 'ADMIN', 'MANAGER', 'STAFF']);
const compensationTypeSchema = z.enum(['HOURLY', 'MONTHLY']);
const leaveTypeSchema = z.enum(['VACATION', 'SICK', 'UNPAID', 'OTHER']);
const permissionSchema = z.custom<AdminPermission>(
  (value) => typeof value === 'string' && isAdminPermission(value),
  'invalid_admin_permission',
);

const commandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('employee.create'),
      shopId: uuidSchema,
      displayName: z.string().trim().min(1).max(160),
      phone: z.string().trim().min(1).max(80).nullable(),
      hireDate: isoDateSchema.nullable(),
      notes: z.string().trim().max(2000).nullable(),
      role: roleSchema,
      commandId: commandIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('employee.update'),
      shopId: uuidSchema,
      employeeId: uuidSchema,
      expectedVersion: z.number().int().positive(),
      displayName: z.string().trim().min(1).max(160),
      phone: z.string().trim().min(1).max(80).nullable(),
      hireDate: isoDateSchema.nullable(),
      notes: z.string().trim().max(2000).nullable(),
      commandId: commandIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('employee.assign-shop'),
      employeeId: uuidSchema,
      shopId: uuidSchema,
      commandId: commandIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('employee.link-worker'),
      employeeId: uuidSchema,
      shopId: uuidSchema,
      workerId: uuidSchema,
      commandId: commandIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('employee.pin'),
      employeeId: uuidSchema,
      shopId: uuidSchema,
      newPin: staffPinSchema,
      requesterPin: staffPinSchema.optional(),
      commandId: commandIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('employee.role'),
      requesterPin: staffPinSchema.optional(),
      employeeId: uuidSchema,
      shopId: uuidSchema,
      role: roleSchema,
      expectedVersion: z.number().int().positive(),
      commandId: commandIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('employee.permission'),
      requesterPin: staffPinSchema.optional(),
      employeeId: uuidSchema,
      shopId: uuidSchema,
      permissionKey: permissionSchema,
      effect: z.enum(['ALLOW', 'DENY']),
      expectedVersion: z.number().int().positive(),
      commandId: commandIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('employee.suspend'),
      requesterPin: staffPinSchema.optional(),
      employeeId: uuidSchema,
      shopId: uuidSchema,
      expectedVersion: z.number().int().positive(),
      commandId: commandIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('employee.reactivate'),
      employeeId: uuidSchema,
      shopId: uuidSchema,
      expectedVersion: z.number().int().positive(),
      commandId: commandIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('compensation.set'),
      employeeId: uuidSchema,
      shopId: uuidSchema,
      compensationType: compensationTypeSchema,
      rateMinor: z.number().int().safe().nonnegative(),
      effectiveFrom: isoDateSchema,
      commandId: commandIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('shift.create'),
      employeeId: uuidSchema,
      shopId: uuidSchema,
      startsAt: isoTimestampSchema,
      endsAt: isoTimestampSchema,
      plannedBreakMinutes: z.number().int().safe().nonnegative(),
      commandId: commandIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('shift.update'),
      shiftId: uuidSchema,
      shopId: uuidSchema,
      expectedVersion: z.number().int().positive(),
      startsAt: isoTimestampSchema,
      endsAt: isoTimestampSchema,
      plannedBreakMinutes: z.number().int().safe().nonnegative(),
      commandId: commandIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('shift.cancel'),
      shiftId: uuidSchema,
      shopId: uuidSchema,
      expectedVersion: z.number().int().positive(),
      commandId: commandIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('shift.copy-previous-week'),
      employeeId: uuidSchema,
      shopId: uuidSchema,
      targetWeekStart: isoDateSchema,
      commandId: commandIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('leave.create'),
      employeeId: uuidSchema,
      shopId: uuidSchema.nullable(),
      leaveType: leaveTypeSchema,
      startsOn: isoDateSchema,
      endsOn: isoDateSchema,
      note: nullableTextSchema,
      commandId: commandIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('leave.decide'),
      leaveRequestId: uuidSchema,
      shopId: uuidSchema,
      expectedVersion: z.number().int().positive(),
      decision: z.enum(['APPROVED', 'REJECTED']),
      reason: nullableTextSchema,
      commandId: commandIdSchema,
    })
    .strict(),
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
      requesterPin: staffPinSchema.optional(),
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

function approvalActor(context: AdminSessionContext): AdminApprovalActor {
  return {
    employeeId: context.principal.employeeId,
    businessId: context.principal.businessId,
    role: context.principal.role,
    permissions: context.principal.permissions,
    shopIds: context.principal.shopIds,
    sessionId: context.session.id,
  };
}

function approvalDependencies(
  request: AdminRequest,
  client: AdminSupabaseClient,
  context: AdminSessionContext,
) {
  const env = getAdminServerEnv();
  const base = createSupabaseApprovalServiceDependencies(client);
  const limiter = createAdminPinRateLimitRpc(client);
  return {
    ...base,
    verifyEmployeePin(employeeId: string, pin: string) {
      return verifyApprovalPinWithRateLimit(
        {
          employeeId,
          sessionId: context.session.id,
          pin,
          fingerprint: clientFingerprint(request),
          rateLimitSecret: env.rateLimitSecret,
        },
        { verifyEmployeePin: base.verifyEmployeePin, limiter },
      );
    },
  };
}

function rpcStaffResult(value: Readonly<Record<string, unknown>>): StaffCommandResult {
  if (value['ok'] !== true) {
    return {
      ok: false,
      code: typeof value['code'] === 'string' ? value['code'] : 'staff_command_failed',
    };
  }
  return {
    ok: true,
    ...(value['replayed'] === true ? { replayed: true } : {}),
    ...(typeof value['employeeId'] === 'string' ? { employeeId: value['employeeId'] } : {}),
    ...(typeof value['credentialVersion'] === 'number'
      ? { credentialVersion: value['credentialVersion'] }
      : {}),
  };
}

function failureStatus(result: StaffCommandResult): number {
  if (result.ok) return 200;
  if (result.code.includes('stale') || result.code.includes('conflict')) return 409;
  if (
    result.code.includes('forbidden') ||
    result.code.includes('permission') ||
    result.code.includes('escalation')
  ) {
    return 403;
  }
  if (result.code.includes('not_found') || result.code.includes('missing')) return 404;
  return 400;
}

function handleFailure(response: AdminResponse, error: unknown): void {
  if (error instanceof AdminAuthError) {
    sendJson(response, error.status, { error: error.code });
    return;
  }
  if (error instanceof AdminRecentReauthError) {
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

export async function handleStaffRequest(
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
    const service = createStaffService(createSupabaseStaffStore(client));

    if (request.method === 'GET') {
      const requestUrl = new URL(request.url ?? '/', 'http://admin.local');
      const shopId = uuidSchema.parse(requestUrl.searchParams.get('shopId'));
      const employeeIdValue = requestUrl.searchParams.get('employeeId');
      const context = await loadContext(request, client, false);

      if (employeeIdValue) {
        const employeeId = uuidSchema.parse(employeeIdValue);
        const employee = await service.loadEmployeeDetail(
          { employeeId, shopId },
          context.principal,
        );
        if (!employee) {
          sendJson(response, 404, { error: 'employee_not_found' });
          return;
        }
        sendJson(response, 200, { employee });
        return;
      }

      sendJson(response, 200, await service.loadWorkspace(shopId, context.principal));
      return;
    }

    if (!requireSameOrigin(request, response)) return;
    const command = commandSchema.parse(await readJsonObject(request));
    const context = await loadContext(request, client, true);

    if (
      command.type === 'employee.pin' ||
      command.type === 'employee.role' ||
      command.type === 'employee.permission' ||
      command.type === 'employee.suspend'
    ) {
      requireRecentReauth(context.session, 300);
    }

    const actor = approvalActor(context);
    const approvalDeps = approvalDependencies(request, client, context);
    let result: StaffCommandResult;
    switch (command.type) {
      case 'employee.create':
        result = await service.createEmployee(command, context.principal);
        break;
      case 'employee.update':
        result = await service.updateEmployeeProfile(command, context.principal);
        break;
      case 'employee.assign-shop':
        result = await service.assignEmployeeShop(command, context.principal);
        break;
      case 'employee.link-worker':
        result = await service.linkEmployeeWorker(command, context.principal);
        break;
      case 'employee.pin': {
        requirePermission(context.principal, 'staff.manage', command.shopId);
        const env = getAdminServerEnv();
        const prepared = await prepareEmployeePinChange(
          {
            actorEmployeeId: context.principal.employeeId,
            businessId: context.principal.businessId,
            employeeId: command.employeeId,
            pin: command.newPin,
            lookupSecret: env.pinLookupSecret,
            commandId: command.commandId,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
          createSupabaseEmployeePinStore(client),
        );
        if (!prepared.ok) {
          result = prepared;
          break;
        }

        result = await executeOrRequestStaffApproval(
          {
            actionType: EMPLOYEE_PIN_CHANGE_APPROVAL_ACTION,
            shopId: command.shopId,
            commandId: command.commandId,
            commandInput: {
              employeeId: command.employeeId,
              targetShopIds: prepared.targetShopIds,
              expectedCredentialVersion: prepared.expectedCredentialVersion,
              commandRef: prepared.commandRef,
            },
            ...(command.requesterPin === undefined ? {} : { requesterPin: command.requesterPin }),
          },
          actor,
          client,
          approvalDeps,
          async () =>
            rpcStaffResult(
              await client.rpc<Record<string, unknown>>('apply_employee_pin_change_v1', {
                p_actor_employee_id: context.principal.employeeId,
                p_command_ref: prepared.commandRef,
              }),
            ),
        );
        break;
      }
      case 'employee.role': {
        requirePermission(context.principal, 'staff.manage', command.shopId);
        const input = {
          employeeId: command.employeeId,
          shopId: command.shopId,
          expectedVersion: command.expectedVersion,
          role: command.role,
          commandId: command.commandId,
        };
        result = await executeOrRequestStaffApproval(
          {
            actionType: EMPLOYEE_ROLE_CHANGE_APPROVAL_ACTION,
            shopId: input.shopId,
            commandId: input.commandId,
            commandInput: {
              employeeId: input.employeeId,
              shopId: input.shopId,
              expectedVersion: input.expectedVersion,
              role: input.role,
            },
            ...(command.requesterPin === undefined ? {} : { requesterPin: command.requesterPin }),
          },
          actor,
          client,
          approvalDeps,
          () => service.setEmployeeRole(input, context.principal),
        );
        break;
      }
      case 'employee.permission': {
        requireBusinessWidePermission(context.principal, 'staff.manage', command.shopId);
        const input = {
          employeeId: command.employeeId,
          shopId: command.shopId,
          permissionKey: command.permissionKey,
          effect: command.effect,
          expectedVersion: command.expectedVersion,
          commandId: command.commandId,
        };
        result = await executeOrRequestStaffApproval(
          {
            actionType: EMPLOYEE_PERMISSION_CHANGE_APPROVAL_ACTION,
            shopId: input.shopId,
            commandId: input.commandId,
            commandInput: {
              employeeId: input.employeeId,
              shopId: input.shopId,
              expectedVersion: input.expectedVersion,
              permissionKey: input.permissionKey,
              effect: input.effect,
            },
            ...(command.requesterPin === undefined ? {} : { requesterPin: command.requesterPin }),
          },
          actor,
          client,
          approvalDeps,
          () => service.setEmployeePermission(input, context.principal),
        );
        break;
      }
      case 'employee.suspend': {
        requirePermission(context.principal, 'staff.manage', command.shopId);
        const input = {
          employeeId: command.employeeId,
          shopId: command.shopId,
          expectedVersion: command.expectedVersion,
          commandId: command.commandId,
        };
        result = await executeOrRequestStaffApproval(
          {
            actionType: EMPLOYEE_SUSPEND_APPROVAL_ACTION,
            shopId: input.shopId,
            commandId: input.commandId,
            commandInput: {
              employeeId: input.employeeId,
              shopId: input.shopId,
              expectedVersion: input.expectedVersion,
            },
            ...(command.requesterPin === undefined ? {} : { requesterPin: command.requesterPin }),
          },
          actor,
          client,
          approvalDeps,
          () => service.suspendEmployee(input, context.principal),
        );
        break;
      }
      case 'employee.reactivate':
        result = await service.reactivateEmployee(command, context.principal);
        break;
      case 'compensation.set':
        result = await service.setCompensation(command, context.principal);
        break;
      case 'shift.create':
        result = await service.createShift(command, context.principal);
        break;
      case 'shift.update':
        result = await service.updateShift(command, context.principal);
        break;
      case 'shift.cancel':
        result = await service.cancelShift(command, context.principal);
        break;
      case 'shift.copy-previous-week':
        result = await service.copyPreviousWeek(command, context.principal);
        break;
      case 'leave.create':
        result = await service.createLeave(command, context.principal);
        break;
      case 'leave.decide':
        result = await service.decideLeave(command, context.principal);
        break;
      case 'attendance.correct':
        result = await service.correctAttendance(command, context.principal);
        break;
      case 'payment.record': {
        requirePermission(context.principal, 'staff.payments', command.shopId);
        const input = {
          employeeId: command.employeeId,
          shopId: command.shopId,
          payPeriodStart: command.payPeriodStart,
          payPeriodEnd: command.payPeriodEnd,
          expectedAmountMinor: command.expectedAmountMinor,
          paidAmountMinor: command.paidAmountMinor,
          financeAccountId: command.financeAccountId,
          paymentDate: command.paymentDate,
          note: command.note,
          reference: command.reference,
          commandId: command.commandId,
        };
        result = await executeOrRequestStaffApproval(
          {
            actionType: STAFF_PAYMENT_APPROVAL_ACTION,
            shopId: input.shopId,
            commandId: input.commandId,
            amountMinor: input.paidAmountMinor,
            commandInput: {
              employeeId: input.employeeId,
              shopId: input.shopId,
              payPeriodStart: input.payPeriodStart,
              payPeriodEnd: input.payPeriodEnd,
              expectedAmountMinor: input.expectedAmountMinor,
              paidAmountMinor: input.paidAmountMinor,
              financeAccountId: input.financeAccountId,
              paymentDate: input.paymentDate,
              note: input.note,
              reference: input.reference,
            },
            ...(command.requesterPin === undefined ? {} : { requesterPin: command.requesterPin }),
          },
          actor,
          client,
          approvalDeps,
          () => service.recordPayment(input, context.principal),
        );
        break;
      }
    }

    sendJson(response, failureStatus(result), result);
  } catch (error) {
    handleFailure(response, error);
  }
}
