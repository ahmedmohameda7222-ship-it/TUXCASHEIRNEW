import type { CatalogCommand } from '@tux/admin-contracts';
import { z } from 'zod';

import { AdminAuthError, loadAdminSession, requireSessionCsrf } from '../../server/adminAuthService';
import { AdminAuthorizationError } from '../../server/authorization';
import {
  CatalogServiceError,
  createCatalogService,
  createSupabaseCatalogStore,
} from '../../server/catalog/catalogService';
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

const bundleChangeSchema = z
  .object({
    kind: z.literal('bundle.replace'),
    bundleJson: z.record(z.unknown()),
    changedPaths: z.array(z.string().min(1).max(240)).max(200).optional(),
  })
  .strict();

const catalogCommandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('draft.save'),
      draftId: z.string().uuid(),
      shopId: z.string().uuid(),
      expectedDraftRevision: z.number().int().positive(),
      changes: z.array(bundleChangeSchema).length(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('draft.publish'),
      draftId: z.string().uuid(),
      shopId: z.string().uuid(),
      expectedDraftRevision: z.number().int().positive(),
      expectedVersion: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal('availability.set'),
      shopId: z.string().uuid(),
      productId: z.string().uuid(),
      soldOut: z.boolean(),
    })
    .strict(),
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
  if (error instanceof CatalogServiceError) {
    sendJson(response, error.code === 'invalid_change_set' ? 400 : 502, { error: error.code });
    return;
  }
  if (error instanceof AdminSupabaseError) {
    if (
      error.responseBody.includes('TUX_ADMIN_CATALOG_FORBIDDEN') ||
      error.responseBody.includes('TUX_ADMIN_CATALOG_SHOP_FORBIDDEN')
    ) {
      sendJson(response, 403, { error: 'permission_forbidden' });
      return;
    }
    console.error('Admin catalog database request failed', { status: error.status });
    sendJson(response, 502, { error: 'admin_backend_unavailable' });
    return;
  }
  console.error('Admin catalog request failed');
  sendJson(response, 500, { error: 'admin_request_failed' });
}

async function loadMutationPrincipal(request: AdminRequest, client: AdminSupabaseClient) {
  const token = readAdminSessionToken(firstHeader(request.headers.cookie));
  if (!token) throw new AdminAuthError('session_required', 401);
  const context = await loadAdminSession(token, client);
  requireSessionCsrf(context, firstHeader(request.headers['x-tux-admin-csrf']).trim());
  return context.principal;
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
  if (!requireSameOrigin(request, response)) return;

  try {
    const parsed = catalogCommandSchema.safeParse(await readJsonObject(request));
    if (!parsed.success) {
      sendJson(response, 400, { error: 'invalid_catalog_request' });
      return;
    }

    const env = getAdminServerEnv();
    const client = new AdminSupabaseClient(env);
    const principal = await loadMutationPrincipal(request, client);
    const service = createCatalogService(createSupabaseCatalogStore(client));
    const command = parsed.data as CatalogCommand;

    if (command.type === 'draft.save') {
      sendJson(response, 200, await service.saveCatalogDraftChange(command, principal));
      return;
    }
    if (command.type === 'draft.publish') {
      sendJson(response, 200, await service.publishCatalogDraft(command, principal));
      return;
    }
    sendJson(response, 200, await service.setImmediateAvailability(command, principal));
  } catch (error) {
    handleFailure(response, error);
  }
}
