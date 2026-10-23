import type { AdminSessionPrincipal } from '@tux/admin-contracts';
import { z } from 'zod';

import {
  AdminAuthError,
  loadAdminSession,
  requireSessionCsrf,
  type AdminSessionContext,
} from '../adminAuthService.js';
import { AdminAuthorizationError } from '../authorization.js';
import { getAdminServerEnv } from '../env.js';
import {
  firstHeader,
  readJsonObject,
  requireSameOrigin,
  sendJson,
  type AdminRequest,
  type AdminResponse,
} from '../http.js';
import { readAdminSessionToken } from '../session.js';
import { AdminSupabaseClient, AdminSupabaseError } from '../supabaseAdmin.js';
import {
  createDailyOperationsService,
  createSupabaseDailyOperationsDependencies,
} from './dailyOperationsService.js';
import {
  createOperationsHealthService,
  createSupabaseOperationsHealthDependencies,
} from './healthService.js';

const uuid = z.string().uuid();
const querySchema = z.discriminatedUnion('view', [
  z.object({ view: z.literal('summary'), shopId: uuid }).strict(),
  z.object({ view: z.literal('devices'), shopId: uuid }).strict(),
  z.object({ view: z.literal('device'), shopId: uuid, deviceId: uuid }).strict(),
  z
    .object({ view: z.literal('daily-checklist'), shopId: uuid, kind: z.enum(['OPEN', 'CLOSE']) })
    .strict(),
  z
    .object({
      view: z.literal('manager-log'),
      shopId: uuid,
      cursor: z.string().datetime({ offset: true }).optional(),
      limit: z.coerce.number().int().min(1).max(50).default(25),
    })
    .strict(),
]);
const commandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('daily.checklist.complete'),
      shopId: uuid,
      businessDayId: uuid,
      kind: z.enum(['OPEN', 'CLOSE']),
      templateId: uuid,
      expectedVersion: z.number().int().positive(),
      doneItemIds: z.array(uuid).max(200),
      commandId: z.string().trim().min(1).max(160),
    })
    .strict(),
  z
    .object({
      type: z.literal('daily.manager-note.append'),
      shopId: uuid,
      note: z.string().min(1).max(2000),
      correctionOfId: uuid.nullable(),
      commandId: z.string().trim().min(1).max(160),
    })
    .strict(),
]);

type OperationsHealthInput = z.infer<typeof querySchema>;
type OperationsCommand = z.infer<typeof commandSchema>;

export type OperationsHealthHandlerDependencies = {
  createClient(): AdminSupabaseClient;
  loadSession(request: AdminRequest, client: AdminSupabaseClient): Promise<AdminSessionContext>;
  read(
    input: OperationsHealthInput,
    principal: AdminSessionPrincipal,
    client: AdminSupabaseClient,
  ): Promise<Readonly<Record<string, unknown>>>;
  mutate?(
    input: OperationsCommand,
    context: AdminSessionContext,
    client: AdminSupabaseClient,
  ): Promise<Readonly<Record<string, unknown>>>;
};

function parseQuery(request: AdminRequest): OperationsHealthInput {
  const url = new URL(request.url ?? '/', 'http://admin.local');
  const values: Record<string, string> = {};
  for (const key of url.searchParams.keys()) {
    if (url.searchParams.getAll(key).length !== 1) throw new z.ZodError([]);
    values[key] = url.searchParams.get(key)!;
  }
  return querySchema.parse(values);
}

function shape(error: unknown): {
  name?: string;
  code?: string;
  status?: number;
  responseBody?: string;
} {
  return typeof error === 'object' && error !== null ? (error as never) : {};
}

function handleFailure(response: AdminResponse, error: unknown): void {
  if (
    error instanceof z.ZodError ||
    (error instanceof Error &&
      ['invalid_json_body', 'request_body_too_large'].includes(error.message))
  ) {
    sendJson(response, 400, { error: 'invalid_operations_health_request' });
    return;
  }
  if (error instanceof Error && error.message === 'device_not_found') {
    sendJson(response, 404, { error: 'device_not_found' });
    return;
  }
  const errorShape = shape(error);
  if (error instanceof AdminAuthError || errorShape.name === 'AdminAuthError') {
    sendJson(response, errorShape.status ?? 401, { error: errorShape.code ?? 'session_required' });
    return;
  }
  if (error instanceof AdminAuthorizationError || errorShape.name === 'AdminAuthorizationError') {
    sendJson(response, 403, { error: errorShape.code ?? 'permission_forbidden' });
    return;
  }
  if (error instanceof AdminSupabaseError || errorShape.name === 'AdminSupabaseError') {
    console.error('Operations health database request failed', { status: errorShape.status });
    sendJson(response, 502, { error: 'admin_backend_unavailable' });
    return;
  }
  console.error('Operations health request failed');
  sendJson(response, 500, { error: 'admin_request_failed' });
}

export function createOperationsHealthRequestHandler(deps: OperationsHealthHandlerDependencies) {
  return async function handleOperationsHealthRequest(
    request: AdminRequest,
    response: AdminResponse,
  ): Promise<void> {
    if (request.method !== 'GET' && request.method !== 'POST') {
      response.setHeader('allow', 'GET, POST');
      sendJson(response, 405, { error: 'method_not_allowed' });
      return;
    }
    try {
      const client = deps.createClient();
      if (request.method === 'GET') {
        const input = parseQuery(request);
        const context = await deps.loadSession(request, client);
        sendJson(response, 200, await deps.read(input, context.principal, client));
        return;
      }
      if (!requireSameOrigin(request, response)) return;
      const context = await deps.loadSession(request, client);
      requireSessionCsrf(context, firstHeader(request.headers['x-tux-admin-csrf']).trim());
      const command = commandSchema.parse(await readJsonObject(request));
      if (!deps.mutate) {
        sendJson(response, 405, { error: 'method_not_allowed' });
        return;
      }
      const result = await deps.mutate(command, context, client);
      if (result['ok'] !== true) {
        const code =
          typeof result['code'] === 'string' ? result['code'] : 'daily_operations_failed';
        sendJson(
          response,
          ['stale_version', 'checklist_already_completed', 'command_id_conflict'].includes(code)
            ? 409
            : 400,
          { error: code },
        );
        return;
      }
      sendJson(response, 200, result);
    } catch (error) {
      handleFailure(response, error);
    }
  };
}

export const handleOperationsHealthRequest = createOperationsHealthRequestHandler({
  createClient: () => new AdminSupabaseClient(getAdminServerEnv()),
  async loadSession(request, client) {
    const token = readAdminSessionToken(firstHeader(request.headers.cookie));
    if (!token) throw new AdminAuthError('session_required', 401);
    return loadAdminSession(token, client);
  },
  async read(input, principal, client) {
    const health = createOperationsHealthService(
      createSupabaseOperationsHealthDependencies(client),
    );
    if (input.view === 'summary')
      return { view: 'summary', health: await health.summary(input.shopId, principal) };
    if (input.view === 'devices')
      return {
        view: 'devices',
        asOf: new Date().toISOString(),
        devices: await health.devices(input.shopId, principal),
      };
    if (input.view === 'device')
      return {
        view: 'device',
        asOf: new Date().toISOString(),
        device: await health.device(input.shopId, input.deviceId, principal),
      };
    const daily = createDailyOperationsService(createSupabaseDailyOperationsDependencies(client));
    if (input.view === 'daily-checklist')
      return {
        view: input.view,
        checklist: await daily.readChecklist({ shopId: input.shopId, kind: input.kind }, principal),
      };
    return {
      view: input.view,
      page: await daily.readManagerLog(
        { shopId: input.shopId, cursor: input.cursor ?? null, limit: input.limit },
        principal,
      ),
    };
  },
  async mutate(input, context, client) {
    const daily = createDailyOperationsService(createSupabaseDailyOperationsDependencies(client));
    if (input.type === 'daily.checklist.complete')
      return daily.completeChecklist(input, context.principal);
    return daily.appendManagerNote(input, context.principal);
  },
});
