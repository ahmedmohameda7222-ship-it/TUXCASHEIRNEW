import { z } from 'zod';

import {
  AdminAuthError,
  loadAdminSession,
  requireSessionCsrf,
  type AdminSessionContext,
} from '../../server/adminAuthService';
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
const localScheduledAtSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/);
const common = {
  shopId: uuidSchema,
  expectedSettingsVersion: z.number().int().nonnegative(),
  localScheduledAt: localScheduledAtSchema,
};

const commandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('settings.schedule-publish'),
      ...common,
    })
    .strict(),
  z
    .object({
      type: z.literal('shop.online-orders.schedule'),
      ...common,
      onlineOrdersPaused: z.boolean(),
    })
    .strict(),
]);

type ScheduleCommand = z.infer<typeof commandSchema>;

type ScheduleResult =
  | {
      ok: true;
      scheduleId: string;
      status: string;
      scheduledFor: string;
      localScheduledAt: string;
      timezone: 'Africa/Cairo';
      idempotentReplay?: boolean;
    }
  | { ok: false; code: string; currentVersion?: number; scheduleId?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseScheduleResult(value: unknown): ScheduleResult {
  if (!isRecord(value) || typeof value['ok'] !== 'boolean') {
    throw new Error('settings_schedule_backend_contract_invalid');
  }
  if (value['ok'] === false) {
    if (typeof value['code'] !== 'string') throw new Error('settings_schedule_backend_contract_invalid');
    return {
      ok: false,
      code: value['code'],
      ...(Number.isSafeInteger(Number(value['currentVersion']))
        ? { currentVersion: Number(value['currentVersion']) }
        : {}),
      ...(typeof value['scheduleId'] === 'string' ? { scheduleId: value['scheduleId'] } : {}),
    };
  }
  if (
    typeof value['scheduleId'] !== 'string' ||
    typeof value['status'] !== 'string' ||
    typeof value['scheduledFor'] !== 'string' ||
    typeof value['localScheduledAt'] !== 'string' ||
    value['timezone'] !== 'Africa/Cairo'
  ) {
    throw new Error('settings_schedule_backend_contract_invalid');
  }
  return {
    ok: true,
    scheduleId: value['scheduleId'],
    status: value['status'],
    scheduledFor: value['scheduledFor'],
    localScheduledAt: value['localScheduledAt'],
    timezone: 'Africa/Cairo',
    ...(value['idempotentReplay'] === true ? { idempotentReplay: true } : {}),
  };
}

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

async function executeSchedule(
  client: AdminSupabaseClient,
  command: ScheduleCommand,
  context: AdminSessionContext,
): Promise<ScheduleResult> {
  requirePermission(context.principal, 'settings.manage', command.shopId);
  const result =
    command.type === 'settings.schedule-publish'
      ? await client.rpc<unknown>('schedule_shop_settings_publish_v1', {
          p_employee_id: context.employee.id,
          p_shop_id: command.shopId,
          p_expected_settings_version: command.expectedSettingsVersion,
          p_local_scheduled_at: command.localScheduledAt,
        })
      : await client.rpc<unknown>('schedule_shop_online_orders_state_v1', {
          p_employee_id: context.employee.id,
          p_shop_id: command.shopId,
          p_online_orders_paused: command.onlineOrdersPaused,
          p_expected_settings_version: command.expectedSettingsVersion,
          p_local_scheduled_at: command.localScheduledAt,
        });
  return parseScheduleResult(result);
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
    const parsed = commandSchema.safeParse(await readJsonObject(request));
    if (!parsed.success) {
      sendJson(response, 400, { error: 'invalid_settings_schedule_request' });
      return;
    }
    const client = new AdminSupabaseClient(getAdminServerEnv());
    const context = await loadContext(request, client);
    sendJson(response, 200, await executeSchedule(client, parsed.data, context));
  } catch (error) {
    if (error instanceof AdminAuthError) {
      sendJson(response, error.status, { error: error.code });
      return;
    }
    if (error instanceof AdminAuthorizationError) {
      sendJson(response, 403, { error: error.code });
      return;
    }
    if (error instanceof AdminSupabaseError) {
      if (
        error.responseBody.includes('TUX_ADMIN_SETTINGS_FORBIDDEN') ||
        error.responseBody.includes('TUX_ADMIN_SETTINGS_SHOP_FORBIDDEN')
      ) {
        sendJson(response, 403, { error: 'permission_forbidden' });
        return;
      }
      console.error('Admin settings scheduling database request failed', { status: error.status });
      sendJson(response, 502, { error: 'admin_backend_unavailable' });
      return;
    }
    console.error('Admin settings scheduling request failed');
    sendJson(response, 502, { error: 'settings_schedule_backend_contract_invalid' });
  }
}
