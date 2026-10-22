import type { AdminSessionPrincipal, WhatsAppAdminCommand, WhatsAppAdminCommandResult, WhatsAppAdminResponse } from '@tux/admin-contracts';
import { z } from 'zod';

import { AdminAuthError, loadAdminSession, requireSessionCsrf, type AdminSessionContext } from '../adminAuthService.js';
import { AdminAuthorizationError } from '../authorization.js';
import { getAdminServerEnv } from '../env.js';
import { firstHeader, readJsonObject, requireSameOrigin, sendJson, type AdminRequest, type AdminResponse } from '../http.js';
import { readAdminSessionToken } from '../session.js';
import { AdminSupabaseClient, AdminSupabaseError } from '../supabaseAdmin.js';
import { createSupabaseWhatsAppAdminDependencies, createWhatsAppAdminService, type WhatsAppAdminReadInput } from './whatsappAdminService.js';

const uuid = z.string().uuid();
const querySchema = z.object({
  view: z.enum(['overview', 'conversations', 'conversation', 'templates', 'quick-replies', 'automatic-messages', 'analytics', 'channels', 'health']),
  shopId: uuid,
  id: uuid.optional(),
  cursor: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict().superRefine((value, context) => {
  if (value.view === 'conversation' && value.id === undefined) context.addIssue({ code: 'custom', path: ['id'], message: 'required' });
  if (value.view !== 'conversation' && value.id !== undefined) context.addIssue({ code: 'custom', path: ['id'], message: 'not allowed' });
});
const base = { shopId: uuid, commandId: z.string().trim().min(1).max(160), expectedVersion: z.number().int().min(0) };
const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('quick-reply.upsert'), ...base, payload: z.object({ id: uuid.nullable(), title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(1024), sortPosition: z.number().int().min(0).max(10_000) }).strict() }).strict(),
  z.object({ type: z.literal('quick-reply.disable'), ...base, payload: z.object({ id: uuid }).strict() }).strict(),
  z.object({ type: z.literal('event-rule.set'), ...base, payload: z.object({ id: uuid, templateId: uuid, languageCode: z.string().trim().min(2).max(16), enabled: z.boolean() }).strict() }).strict(),
  z.object({ type: z.literal('channel.assign'), ...base, payload: z.object({ channelId: uuid }).strict() }).strict(),
  z.object({ type: z.literal('preferences.update'), ...base, payload: z.object({ automationEnabled: z.boolean() }).strict() }).strict(),
]);

export type WhatsAppAdminHandlerDependencies = {
  createClient(): AdminSupabaseClient;
  loadSession(request: AdminRequest, client: AdminSupabaseClient): Promise<AdminSessionContext>;
  read(input: WhatsAppAdminReadInput, principal: AdminSessionPrincipal, client: AdminSupabaseClient): Promise<WhatsAppAdminResponse>;
  mutate(command: WhatsAppAdminCommand, principal: AdminSessionPrincipal, client: AdminSupabaseClient): Promise<WhatsAppAdminCommandResult>;
};

function parseQuery(request: AdminRequest): WhatsAppAdminReadInput {
  const url = new URL(request.url ?? '/', 'http://admin.local');
  const values: Record<string, string> = {};
  for (const key of url.searchParams.keys()) {
    if (url.searchParams.getAll(key).length !== 1) throw new z.ZodError([]);
    values[key] = url.searchParams.get(key)!;
  }
  const parsed = querySchema.parse(values);
  return { view: parsed.view, shopId: parsed.shopId, id: parsed.id ?? null, cursor: parsed.cursor ?? null, limit: parsed.limit };
}

function shape(error: unknown): { name?: string; code?: string; status?: number } {
  return typeof error === 'object' && error !== null ? error as never : {};
}

function failure(response: AdminResponse, error: unknown): void {
  if (error instanceof z.ZodError || (error instanceof Error && ['invalid_json_body', 'request_body_too_large', 'conversation_id_required'].includes(error.message))) { sendJson(response, 400, { error: 'invalid_whatsapp_request' }); return; }
  if (error instanceof Error && error.message === 'conversation_not_found') { sendJson(response, 404, { error: 'conversation_not_found' }); return; }
  const value = shape(error);
  if (error instanceof AdminAuthError || value.name === 'AdminAuthError') { sendJson(response, value.status ?? 401, { error: value.code ?? 'session_required' }); return; }
  if (error instanceof AdminAuthorizationError || value.name === 'AdminAuthorizationError') { sendJson(response, 403, { error: value.code ?? 'permission_forbidden' }); return; }
  if (error instanceof AdminSupabaseError || value.name === 'AdminSupabaseError') { console.error('Admin WhatsApp database request failed', { status: value.status }); sendJson(response, 502, { error: 'admin_backend_unavailable' }); return; }
  console.error('Admin WhatsApp request failed'); sendJson(response, 500, { error: 'admin_request_failed' });
}

export function createWhatsAppAdminRequestHandler(deps: WhatsAppAdminHandlerDependencies) {
  return async function handleWhatsAppAdminRequest(request: AdminRequest, response: AdminResponse): Promise<void> {
    if (request.method !== 'GET' && request.method !== 'POST') { response.setHeader('allow', 'GET, POST'); sendJson(response, 405, { error: 'method_not_allowed' }); return; }
    try {
      const client = deps.createClient();
      const context = await deps.loadSession(request, client);
      if (request.method === 'GET') { sendJson(response, 200, await deps.read(parseQuery(request), context.principal, client) as unknown as Readonly<Record<string, unknown>>); return; }
      if (!requireSameOrigin(request, response)) return;
      requireSessionCsrf(context, firstHeader(request.headers['x-tux-admin-csrf']).trim());
      const result = await deps.mutate(commandSchema.parse(await readJsonObject(request)), context.principal, client);
      if (!result.ok) { sendJson(response, result.code === 'stale_version' || result.code === 'command_id_conflict' ? 409 : result.code.includes('permission') ? 403 : 400, { error: result.code }); return; }
      sendJson(response, 200, result as unknown as Readonly<Record<string, unknown>>);
    } catch (error) { failure(response, error); }
  };
}

export const handleWhatsAppAdminRequest = createWhatsAppAdminRequestHandler({
  createClient: () => new AdminSupabaseClient(getAdminServerEnv()),
  async loadSession(request, client) {
    const token = readAdminSessionToken(firstHeader(request.headers.cookie));
    if (!token) throw new AdminAuthError('session_required', 401);
    return loadAdminSession(token, client);
  },
  read(input, principal, client) { return createWhatsAppAdminService(createSupabaseWhatsAppAdminDependencies(client)).read(input, principal); },
  mutate(command, principal, client) { return createWhatsAppAdminService(createSupabaseWhatsAppAdminDependencies(client)).mutate(command, principal); },
});
