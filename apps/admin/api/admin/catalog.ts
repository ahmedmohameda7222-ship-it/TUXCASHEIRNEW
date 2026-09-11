import type { AdminSessionPrincipal, CatalogCommand } from '@tux/admin-contracts';
import { z } from 'zod';

import {
  AdminAuthError,
  loadAdminSession,
  requireSessionCsrf,
} from '../../server/adminAuthService';
import { AdminAuthorizationError } from '../../server/authorization';
import {
  CatalogServiceError,
  createCatalogService,
  createSupabaseCatalogStore,
} from '../../server/catalog/catalogService';
import {
  createRecurringAvailabilityService,
  createSupabaseRecurringAvailabilityStore,
  RecurringAvailabilityServiceError,
} from '../../server/catalog/recurringAvailabilityService';
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
const cairoLocalTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?$/);
const localTimeSchema = z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/);
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
      type: z.literal('draft.create'),
      shopId: uuidSchema,
      expectedVersion: z.number().int().nonnegative(),
      title: z.string().trim().min(1).max(120).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('draft.save'),
      draftId: uuidSchema,
      shopId: uuidSchema,
      expectedDraftRevision: z.number().int().positive(),
      changes: z.array(bundleChangeSchema).length(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('draft.publish'),
      draftId: uuidSchema,
      shopId: uuidSchema,
      expectedDraftRevision: z.number().int().positive(),
      expectedVersion: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal('availability.set'),
      shopId: uuidSchema,
      productId: uuidSchema,
      soldOut: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal('availability.recurring.save'),
      shopId: uuidSchema,
      ruleId: uuidSchema.nullable(),
      masterProductId: uuidSchema,
      daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
      startLocal: localTimeSchema,
      endLocal: localTimeSchema,
      available: z.boolean(),
      active: z.boolean(),
      expectedVersion: z.number().int().positive().nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal('version.restore'),
      shopId: uuidSchema,
      sourcePublishVersion: z.number().int().positive(),
      expectedVersion: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal('draft.schedule'),
      draftId: uuidSchema,
      shopId: uuidSchema,
      expectedDraftRevision: z.number().int().positive(),
      expectedVersion: z.number().int().nonnegative(),
      localScheduledAt: cairoLocalTimestampSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('schedule.cancel'),
      shopId: uuidSchema,
      scheduleId: uuidSchema,
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
    const badRequest = error.code === 'invalid_change_set' || error.code === 'invalid_scheduled_time';
    sendJson(response, badRequest ? 400 : 502, { error: error.code });
    return;
  }
  if (error instanceof RecurringAvailabilityServiceError) {
    sendJson(response, 502, { error: error.code });
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

async function loadPrincipal(
  request: AdminRequest,
  client: AdminSupabaseClient,
  csrfRequired: boolean,
): Promise<AdminSessionPrincipal> {
  const token = readAdminSessionToken(firstHeader(request.headers.cookie));
  if (!token) throw new AdminAuthError('session_required', 401);
  const context = await loadAdminSession(token, client);
  if (csrfRequired) {
    requireSessionCsrf(context, firstHeader(request.headers['x-tux-admin-csrf']).trim());
  }
  return context.principal;
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
    const env = getAdminServerEnv();
    const client = new AdminSupabaseClient(env);
    const service = createCatalogService(createSupabaseCatalogStore(client));
    const recurringService = createRecurringAvailabilityService(
      createSupabaseRecurringAvailabilityStore(client),
    );

    if (request.method === 'GET') {
      const requestUrl = new URL(request.url ?? '/', 'http://admin.local');
      const shopId = uuidSchema.safeParse(requestUrl.searchParams.get('shopId'));
      if (!shopId.success) {
        sendJson(response, 400, { error: 'invalid_catalog_request' });
        return;
      }
      const principal = await loadPrincipal(request, client, false);
      const view = requestUrl.searchParams.get('view');
      if (view === 'publishing') {
        const publishing = await service.loadCatalogPublishing(shopId.data, principal);
        sendJson(response, 200, { ...publishing });
        return;
      }
      if (view === 'recurring-availability') {
        const recurring = await recurringService.loadRecurringAvailability(shopId.data, principal);
        sendJson(response, 200, { ...recurring });
        return;
      }
      const workspace = await service.loadCatalogWorkspace(shopId.data, principal);
      sendJson(response, 200, { ...workspace });
      return;
    }

    if (!requireSameOrigin(request, response)) return;
    const parsed = catalogCommandSchema.safeParse(await readJsonObject(request));
    if (!parsed.success) {
      sendJson(response, 400, { error: 'invalid_catalog_request' });
      return;
    }

    const principal = await loadPrincipal(request, client, true);
    const command = parsed.data as unknown as CatalogCommand;

    switch (command.type) {
      case 'draft.create':
        sendJson(response, 200, { ...(await service.createCatalogDraft(command, principal)) });
        return;
      case 'draft.save':
        sendJson(response, 200, { ...(await service.saveCatalogDraftChange(command, principal)) });
        return;
      case 'draft.publish':
        sendJson(response, 200, { ...(await service.publishCatalogDraft(command, principal)) });
        return;
      case 'availability.set':
        sendJson(response, 200, { ...(await service.setImmediateAvailability(command, principal)) });
        return;
      case 'availability.recurring.save':
        sendJson(response, 200, {
          ...(await recurringService.saveRecurringAvailabilityRule(command, principal)),
        });
        return;
      case 'version.restore':
        sendJson(response, 200, { ...(await service.restoreCatalogVersion(command, principal)) });
        return;
      case 'draft.schedule':
        sendJson(response, 200, { ...(await service.scheduleCatalogDraft(command, principal)) });
        return;
      case 'schedule.cancel':
        sendJson(response, 200, {
          ...(await service.cancelScheduledCatalogChange(command, principal)),
        });
        return;
    }
  } catch (error) {
    handleFailure(response, error);
  }
}
