import type { AdminSessionPrincipal, CatalogCommand } from '@tux/admin-contracts';
import { z } from 'zod';

import {
  AdminAuthError,
  loadAdminSession,
  requireSessionCsrf,
} from '../../server/adminAuthService.js';
import { AdminAuthorizationError, requirePermission } from '../../server/authorization.js';
import { executeCatalogPricePublish } from '../../server/catalog/catalogPricePublishRoute.js';
import { resumeCatalogDraft } from '../../server/catalog/catalogDraftResume.js';
import {
  CatalogServiceError,
  createCatalogService,
  createSupabaseCatalogStore,
} from '../../server/catalog/catalogService.js';
import {
  createRecurringAvailabilityService,
  createSupabaseRecurringAvailabilityStore,
  RecurringAvailabilityServiceError,
} from '../../server/catalog/recurringAvailabilityService.js';
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
const cairoLocalTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?$/);
const localTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/);
const bundleChangeSchema = z
  .object({
    kind: z.literal('bundle.replace'),
    bundleJson: z.record(z.unknown()),
    changedPaths: z.array(z.string().min(1).max(240)).max(200).optional(),
  })
  .strict();

const catalogCopyBaseSchema = z.object({
  sourceShopId: uuidSchema,
  targetShopId: uuidSchema,
  targetDraftId: uuidSchema,
  expectedSourcePublishVersion: z.number().int().positive(),
  expectedTargetPublishVersion: z.number().int().nonnegative(),
  expectedTargetDraftRevision: z.number().int().positive(),
  selectedDomains: z
    .array(
      z.enum([
        'productPrices',
        'productAvailability',
        'categoryOrder',
        'categoryAvailability',
        'productOrder',
        'productCategoryAssignments',
        'comboBeverageOptions',
        'productModifierLinks',
        'modifierDefinitions',
        'recipeLines',
      ]),
    )
    .min(1)
    .max(10)
    .refine((domains) => new Set(domains).size === domains.length),
});

export const catalogCopySchema = z.discriminatedUnion('type', [
  catalogCopyBaseSchema
    .omit({ selectedDomains: true })
    .extend({ type: z.literal('catalog-copy.missing-preview') })
    .strict(),
  catalogCopyBaseSchema
    .omit({ selectedDomains: true })
    .extend({
      type: z.literal('catalog-copy.stage-created-entities'),
      selectedSourceCategoryIds: z.array(uuidSchema).max(100),
      selectedSourceProductIds: z.array(uuidSchema).max(200),
      creationFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
      commandId: z.string().trim().min(1).max(128),
    })
    .strict(),
  catalogCopyBaseSchema.extend({ type: z.literal('catalog-copy.preview') }).strict(),
  catalogCopyBaseSchema
    .extend({
      type: z.literal('catalog-copy.apply'),
      previewFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
      commandId: z.string().trim().min(1).max(160),
    })
    .strict(),
]);

export const catalogViewSchema = z.enum(['workspace', 'publishing', 'recurring-availability']);

export const catalogCommandSchema = z.discriminatedUnion('type', [
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
      type: z.literal('draft.resume'),
      draftId: uuidSchema,
      shopId: uuidSchema,
      expectedVersion: z.number().int().nonnegative(),
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
      requesterPin: z.string().min(1).max(64).optional(),
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
    const badRequest =
      error.code === 'invalid_change_set' || error.code === 'invalid_scheduled_time';
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
      const view = catalogViewSchema.safeParse(requestUrl.searchParams.get('view') ?? 'workspace');
      if (!shopId.success || !view.success) {
        sendJson(response, 400, { error: 'invalid_catalog_request' });
        return;
      }
      const principal = await loadPrincipal(request, client, false);
      if (view.data === 'publishing') {
        const publishing = await service.loadCatalogPublishing(shopId.data, principal);
        sendJson(response, 200, { ...publishing });
        return;
      }
      if (view.data === 'recurring-availability') {
        const recurring = await recurringService.loadRecurringAvailability(shopId.data, principal);
        sendJson(response, 200, { ...recurring });
        return;
      }
      const workspace = await service.loadCatalogWorkspace(shopId.data, principal);
      sendJson(response, 200, { ...workspace });
      return;
    }

    if (!requireSameOrigin(request, response)) return;
    const rawCommand = await readJsonObject(request);
    if (
      typeof rawCommand === 'object' &&
      rawCommand !== null &&
      'type' in rawCommand &&
      (rawCommand.type === 'catalog-copy.preview' ||
        rawCommand.type === 'catalog-copy.apply' ||
        rawCommand.type === 'catalog-copy.missing-preview' ||
        rawCommand.type === 'catalog-copy.stage-created-entities')
    ) {
      const copy = catalogCopySchema.safeParse(rawCommand);
      if (!copy.success || copy.data.sourceShopId === copy.data.targetShopId) {
        sendJson(response, 400, { error: 'invalid_catalog_copy_request' });
        return;
      }
      const principal = await loadPrincipal(request, client, true);
      requirePermission(principal, 'catalog.view', copy.data.sourceShopId);
      requirePermission(principal, 'catalog.edit', copy.data.targetShopId);
      if (copy.data.type === 'catalog-copy.missing-preview') {
        const result = await client.rpc<Readonly<Record<string, unknown>>>(
          'preview_admin_catalog_missing_entities_v1',
          {
            p_employee_id: principal.employeeId,
            p_source_shop_id: copy.data.sourceShopId,
            p_target_shop_id: copy.data.targetShopId,
            p_target_draft_id: copy.data.targetDraftId,
            p_source_publish_version: copy.data.expectedSourcePublishVersion,
            p_target_publish_version: copy.data.expectedTargetPublishVersion,
            p_target_draft_revision: copy.data.expectedTargetDraftRevision,
          },
        );
        if (result['ok'] !== true && result['ok'] !== false) {
          sendJson(response, 502, { error: 'backend_contract_invalid' });
          return;
        }
        sendJson(response, result['ok'] === true ? 200 : 409, result);
        return;
      }
      if (copy.data.type === 'catalog-copy.stage-created-entities') {
        const categories = copy.data.selectedSourceCategoryIds;
        const products = copy.data.selectedSourceProductIds;
        if (
          categories.length + products.length === 0 ||
          new Set(categories).size !== categories.length ||
          new Set(products).size !== products.length
        ) {
          sendJson(response, 400, { error: 'invalid_catalog_copy_selection' });
          return;
        }
        if (products.length > 0) {
          requirePermission(principal, 'catalog.pricing', copy.data.targetShopId);
        }
        const result = await client.rpc<Readonly<Record<string, unknown>>>(
          'stage_admin_catalog_copy_created_entities_v1',
          {
            p_employee_id: principal.employeeId,
            p_source_shop_id: copy.data.sourceShopId,
            p_target_shop_id: copy.data.targetShopId,
            p_target_draft_id: copy.data.targetDraftId,
            p_source_publish_version: copy.data.expectedSourcePublishVersion,
            p_target_publish_version: copy.data.expectedTargetPublishVersion,
            p_target_draft_revision: copy.data.expectedTargetDraftRevision,
            p_source_category_ids: categories,
            p_source_product_ids: products,
            p_creation_fingerprint: copy.data.creationFingerprint,
            p_command_id: copy.data.commandId,
          },
        );
        if (result['ok'] !== true && result['ok'] !== false) {
          sendJson(response, 502, { error: 'backend_contract_invalid' });
          return;
        }
        sendJson(response, result['ok'] === true ? 200 : 409, result);
        return;
      }
      if (copy.data.selectedDomains.includes('recipeLines')) {
        requirePermission(principal, 'inventory.view', copy.data.sourceShopId);
        requirePermission(principal, 'inventory.adjust', copy.data.targetShopId);
      }
      if (
        copy.data.selectedDomains.includes('productPrices') ||
        copy.data.selectedDomains.includes('modifierDefinitions')
      ) {
        requirePermission(principal, 'catalog.pricing', copy.data.targetShopId);
      }
      const result = await client.rpc<Readonly<Record<string, unknown>>>(
        copy.data.type === 'catalog-copy.preview'
          ? 'preview_admin_catalog_shop_copy_v1'
          : 'apply_admin_catalog_shop_copy_v1',
        {
          p_employee_id: principal.employeeId,
          p_source_shop_id: copy.data.sourceShopId,
          p_target_shop_id: copy.data.targetShopId,
          p_target_draft_id: copy.data.targetDraftId,
          p_source_publish_version: copy.data.expectedSourcePublishVersion,
          p_target_publish_version: copy.data.expectedTargetPublishVersion,
          p_target_draft_revision: copy.data.expectedTargetDraftRevision,
          p_domains: copy.data.selectedDomains,
          ...(copy.data.type === 'catalog-copy.apply'
            ? {
                p_preview_fingerprint: copy.data.previewFingerprint,
                p_command_id: copy.data.commandId,
              }
            : {}),
        },
      );
      if (result['ok'] !== true && result['ok'] !== false) {
        sendJson(response, 502, { error: 'backend_contract_invalid' });
        return;
      }
      sendJson(response, result['ok'] === true ? 200 : 409, result);
      return;
    }
    const parsed = catalogCommandSchema.safeParse(rawCommand);
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
      case 'draft.resume':
        sendJson(response, 200, { ...(await resumeCatalogDraft(client, command, principal)) });
        return;
      case 'draft.save':
        sendJson(response, 200, { ...(await service.saveCatalogDraftChange(command, principal)) });
        return;
      case 'draft.publish': {
        const token = readAdminSessionToken(firstHeader(request.headers.cookie));
        if (!token) throw new AdminAuthError('session_required', 401);
        const context = await loadAdminSession(token, client);
        sendJson(response, 200, {
          ...(await executeCatalogPricePublish(client, context, command, request)),
        });
        return;
      }
      case 'availability.set':
        sendJson(response, 200, {
          ...(await service.setImmediateAvailability(command, principal)),
        });
        return;
      case 'availability.recurring.save':
        // Preserve existing rules; do not accept unexecutable unattended transitions.
        sendJson(response, 409, { ok: false, code: 'scheduler_unavailable' });
        return;
      case 'version.restore':
        sendJson(response, 200, { ...(await service.restoreCatalogVersion(command, principal)) });
        return;
      case 'draft.schedule':
        // The Vercel Free deployment has no verified unattended scheduler.
        sendJson(response, 409, { ok: false, code: 'scheduler_unavailable' });
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
