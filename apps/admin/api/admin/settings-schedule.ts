import type { AdminShopConfigSchedule } from '@tux/admin-contracts';
import { z } from 'zod';

import {
  AdminAuthError,
  loadAdminSession,
  requireSessionCsrf,
  type AdminSessionContext,
} from '../../server/adminAuthService.js';
import { AdminAuthorizationError, requirePermission } from '../../server/authorization.js';
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
import { AdminSupabaseClient, AdminSupabaseError } from '../../server/supabaseAdmin.js';

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

type ScheduleRow = {
  id: string;
  payload_json: unknown;
  status: string;
  timezone: string;
  local_scheduled_at: string;
  scheduled_for: string;
  attempt_count: number;
  terminal_failure: boolean;
  next_attempt_at: string | null;
  last_error: string | null;
};

const scheduleStatuses = new Set(['PENDING', 'CLAIMED', 'APPLIED', 'FAILED', 'CANCELLED']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseScheduleResult(value: unknown): ScheduleResult {
  if (!isRecord(value) || typeof value['ok'] !== 'boolean') {
    throw new Error('settings_schedule_backend_contract_invalid');
  }
  if (value['ok'] === false) {
    if (typeof value['code'] !== 'string')
      throw new Error('settings_schedule_backend_contract_invalid');
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

function parseScheduleRow(row: ScheduleRow): AdminShopConfigSchedule {
  if (
    !scheduleStatuses.has(row.status) ||
    row.timezone !== 'Africa/Cairo' ||
    !Number.isSafeInteger(row.attempt_count) ||
    row.attempt_count < 0 ||
    typeof row.terminal_failure !== 'boolean' ||
    !isRecord(row.payload_json)
  ) {
    throw new Error('settings_schedule_backend_contract_invalid');
  }
  const operation = row.payload_json['operation'];
  const onlineOrdersPaused = row.payload_json['onlineOrdersPaused'];
  if (operation !== 'PUBLISH_SETTINGS' && operation !== 'ONLINE_ORDERS_STATE') {
    throw new Error('settings_schedule_backend_contract_invalid');
  }
  if (
    operation === 'PUBLISH_SETTINGS' &&
    onlineOrdersPaused !== null &&
    onlineOrdersPaused !== undefined
  ) {
    throw new Error('settings_schedule_backend_contract_invalid');
  }
  if (operation === 'ONLINE_ORDERS_STATE' && typeof onlineOrdersPaused !== 'boolean') {
    throw new Error('settings_schedule_backend_contract_invalid');
  }
  const normalizedOnlineOrdersPaused: boolean | null =
    operation === 'ONLINE_ORDERS_STATE' ? (onlineOrdersPaused as boolean) : null;
  return {
    id: row.id,
    operation,
    onlineOrdersPaused: normalizedOnlineOrdersPaused,
    status: row.status as AdminShopConfigSchedule['status'],
    timezone: 'Africa/Cairo',
    localScheduledAt: row.local_scheduled_at,
    scheduledFor: row.scheduled_for,
    attemptCount: row.attempt_count,
    terminalFailure: row.terminal_failure,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
  };
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

async function loadSchedules(
  client: AdminSupabaseClient,
  shopId: string,
  context: AdminSessionContext,
): Promise<AdminShopConfigSchedule[]> {
  requirePermission(context.principal, 'settings.manage', shopId);
  const query = new URLSearchParams({
    select:
      'id,payload_json,status,timezone,local_scheduled_at,scheduled_for,attempt_count,terminal_failure,next_attempt_at,last_error',
    business_id: `eq.${context.principal.businessId}`,
    shop_id: `eq.${shopId}`,
    change_kind: 'eq.SHOP_CONFIG',
    order: 'scheduled_for.desc,id.desc',
    limit: '50',
  });
  const rows = await client.select<ScheduleRow[]>('scheduled_config_changes', query);
  return rows.map(parseScheduleRow);
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
  if (request.method !== 'GET' && request.method !== 'POST') {
    response.setHeader('allow', 'GET, POST');
    sendJson(response, 405, { error: 'method_not_allowed' });
    return;
  }
  try {
    const client = new AdminSupabaseClient(getAdminServerEnv());
    if (request.method === 'GET') {
      const requestUrl = new URL(request.url ?? '/', 'http://admin.local');
      const shopId = uuidSchema.safeParse(requestUrl.searchParams.get('shopId'));
      if (!shopId.success) {
        sendJson(response, 400, { error: 'invalid_settings_schedule_request' });
        return;
      }
      const context = await loadContext(request, client, false);
      sendJson(response, 200, { schedules: await loadSchedules(client, shopId.data, context) });
      return;
    }

    if (!requireSameOrigin(request, response)) return;
    const parsed = commandSchema.safeParse(await readJsonObject(request));
    if (!parsed.success) {
      sendJson(response, 400, { error: 'invalid_settings_schedule_request' });
      return;
    }
    const context = await loadContext(request, client, true);
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
