import type { AdminAlertsPage, AdminSessionPrincipal } from '@tux/admin-contracts';
import { z } from 'zod';

import { AdminAuthError, loadAdminSession, type AdminSessionContext } from '../adminAuthService.js';
import { AdminAuthorizationError } from '../authorization.js';
import { getAdminServerEnv } from '../env.js';
import { firstHeader, sendJson, type AdminRequest, type AdminResponse } from '../http.js';
import { readAdminSessionToken } from '../session.js';
import { AdminSupabaseClient, AdminSupabaseError } from '../supabaseAdmin.js';
import {
  createAlertsService,
  createSupabaseAlertsDependencies,
  type AlertsReadInput,
} from './alertsService.js';

const querySchema = z
  .object({
    shopId: z.string().uuid(),
    source: z.enum(['APPROVAL', 'INVENTORY', 'DELIVERY', 'OPERATIONS', 'WHATSAPP']).optional(),
    severity: z.enum(['CRITICAL', 'WARNING', 'INFO']).optional(),
    state: z.enum(['ACTIVE', 'RESOLVED']).optional(),
    cursor: z.string().min(1).max(2_048).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export type AlertsHandlerDependencies = {
  createClient(): AdminSupabaseClient;
  loadSession(request: AdminRequest, client: AdminSupabaseClient): Promise<AdminSessionContext>;
  list(
    input: AlertsReadInput,
    principal: AdminSessionPrincipal,
    client: AdminSupabaseClient,
  ): Promise<AdminAlertsPage>;
};

function parseQuery(request: AdminRequest): AlertsReadInput {
  const url = new URL(request.url ?? '/', 'http://admin.local');
  const allowed = new Set(['shopId', 'source', 'severity', 'state', 'cursor', 'limit']);
  const values: Record<string, string> = {};
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) {
      throw new z.ZodError([]);
    }
    values[key] = url.searchParams.get(key)!;
  }
  return querySchema.parse(values);
}

function errorShape(error: unknown): { name?: string; code?: string; status?: number } {
  return typeof error === 'object' && error !== null ? (error as never) : {};
}

function handleFailure(response: AdminResponse, error: unknown): void {
  if (
    error instanceof z.ZodError ||
    (error instanceof Error && error.message === 'invalid_alerts_cursor')
  ) {
    sendJson(response, 400, { error: 'invalid_alerts_request' });
    return;
  }
  const shape = errorShape(error);
  if (error instanceof AdminAuthError || shape.name === 'AdminAuthError') {
    sendJson(response, shape.status ?? 401, { error: shape.code ?? 'session_required' });
    return;
  }
  if (error instanceof AdminAuthorizationError || shape.name === 'AdminAuthorizationError') {
    sendJson(response, 403, { error: shape.code ?? 'permission_forbidden' });
    return;
  }
  if (error instanceof AdminSupabaseError || shape.name === 'AdminSupabaseError') {
    console.error('Admin alerts database request failed', { status: shape.status });
    sendJson(response, 502, { error: 'admin_backend_unavailable' });
    return;
  }
  console.error('Admin alerts request failed');
  sendJson(response, 500, { error: 'admin_request_failed' });
}

export function createAlertsRequestHandler(deps: AlertsHandlerDependencies) {
  return async function handleAlertsRequest(
    request: AdminRequest,
    response: AdminResponse,
  ): Promise<void> {
    if (request.method !== 'GET') {
      response.setHeader('allow', 'GET');
      sendJson(response, 405, { error: 'method_not_allowed' });
      return;
    }
    try {
      const input = parseQuery(request);
      const client = deps.createClient();
      const context = await deps.loadSession(request, client);
      sendJson(response, 200, await deps.list(input, context.principal, client));
    } catch (error) {
      handleFailure(response, error);
    }
  };
}

export const handleAlertsRequest = createAlertsRequestHandler({
  createClient() {
    return new AdminSupabaseClient(getAdminServerEnv());
  },
  async loadSession(request, client) {
    const token = readAdminSessionToken(firstHeader(request.headers.cookie));
    if (!token) throw new AdminAuthError('session_required', 401);
    return loadAdminSession(token, client);
  },
  async list(input, principal, client) {
    return createAlertsService(createSupabaseAlertsDependencies(client)).list(input, principal);
  },
});
