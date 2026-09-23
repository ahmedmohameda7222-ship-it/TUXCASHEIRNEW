import type { AdminPromotionUpsertInput, AdminReasonCodeConfiguration } from '@tux/admin-contracts';
import { z } from 'zod';

import {
  AdminAuthError,
  loadAdminSession,
  requireSessionCsrf,
  type AdminSessionContext,
} from '../adminAuthService.js';
import { AdminAuthorizationError, requirePermission } from '../authorization.js';
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
import { createCrmService } from './crmService.js';
import { createCrmStore } from './crmStore.js';

const uuidSchema = z.string().uuid();
const commandIdSchema = z.string().trim().min(1).max(160);
const nullablePositiveInteger = z.number().int().safe().positive().nullable();

const promotionSchema = z
  .object({
    id: uuidSchema.nullable(),
    expectedVersion: z.number().int().safe().positive().nullable(),
    name: z.string().trim().min(1).max(160),
    active: z.boolean(),
    kind: z.enum(['PERCENT', 'FIXED', 'FREE_ITEM']),
    percentBasisPoints: z.number().int().min(1).max(10_000).nullable(),
    fixedDiscountMinor: z.number().int().safe().nonnegative().nullable(),
    freeProductId: uuidSchema.nullable(),
    startsAt: z.string().datetime().nullable(),
    endsAt: z.string().datetime().nullable(),
    minimumOrderMinor: z.number().int().safe().nonnegative(),
    shopIds: z.array(uuidSchema).max(500),
    channel: z.enum(['POS', 'ONLINE', 'BOTH']),
    productIds: z.array(uuidSchema).max(5_000),
    categoryIds: z.array(uuidSchema).max(5_000),
    totalUsageLimit: nullablePositiveInteger,
    perCustomerUsageLimit: nullablePositiveInteger,
    stackingPolicy: z.enum(['ONE_ORDER_LEVEL', 'ALLOW_CONFIGURED']),
  })
  .strict();

const commandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('loyalty.program.upsert'),
      shopId: uuidSchema,
      enabled: z.boolean(),
      earnPointsPer100Minor: z.number().int().safe().nonnegative(),
      redemptionMinorPerPoint: z.number().int().safe().positive(),
      minimumRedemptionPoints: z.number().int().safe().positive(),
      pointExpiryDays: z.number().int().safe().positive().nullable(),
      shopIds: z.array(uuidSchema).max(500),
      expectedVersion: z.number().int().safe().positive().nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal('loyalty.adjust'),
      shopId: uuidSchema,
      customerId: uuidSchema,
      pointsDelta: z
        .number()
        .int()
        .safe()
        .refine((value) => value !== 0),
      reasonCodeId: uuidSchema,
      note: z.string().trim().max(500).nullable(),
      commandId: commandIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('promotion.upsert'),
      shopId: uuidSchema,
      promotion: promotionSchema,
      commandId: commandIdSchema,
    })
    .strict(),
]);

type ReasonRow = {
  id: string;
  shop_id: string | null;
  reason_key: string;
  family: AdminReasonCodeConfiguration['family'];
  label: string;
  active: boolean;
  version: number | string;
};

function safeInteger(value: number | string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error('crm_backend_contract_invalid');
  }
  return parsed;
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

async function listAdjustmentReasons(
  client: AdminSupabaseClient,
  context: AdminSessionContext,
  shopId: string,
): Promise<readonly AdminReasonCodeConfiguration[]> {
  requirePermission(context.principal, 'loyalty.manage', shopId);
  const rows = await client.select<ReasonRow[]>(
    'admin_reason_codes',
    new URLSearchParams({
      select: 'id,shop_id,reason_key,family,label,active,version',
      business_id: `eq.${context.principal.businessId}`,
      or: `(shop_id.is.null,shop_id.eq.${shopId})`,
      active: 'eq.true',
      family: 'eq.DISCOUNT_COMP',
      order: 'reason_key.asc,shop_id.desc.nullslast',
    }),
  );
  return rows.map((row) => ({
    id: row.id,
    scope: row.shop_id === null ? 'BUSINESS' : 'SHOP',
    key: row.reason_key,
    family: row.family,
    label: row.label,
    active: row.active,
    version: safeInteger(row.version),
  }));
}

function mutationStatus(result: { ok: boolean; code?: string }): number {
  if (result.ok) return 200;
  const code = result.code ?? '';
  if (code.includes('permission') || code.includes('forbidden')) return 403;
  if (code.includes('not_found')) return 404;
  if (
    code.includes('conflict') ||
    code.includes('stale') ||
    code.includes('insufficient') ||
    code.includes('limit')
  ) {
    return 409;
  }
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
  if (error instanceof z.ZodError) {
    sendJson(response, 400, { error: 'invalid_crm_request' });
    return;
  }
  if (error instanceof AdminSupabaseError) {
    if (
      error.responseBody.includes('TUX_ADMIN_LOYALTY_PERMISSION_REQUIRED') ||
      error.responseBody.includes('TUX_ADMIN_LOYALTY_SHOP_FORBIDDEN')
    ) {
      sendJson(response, 403, { error: 'permission_forbidden' });
      return;
    }
    if (error.responseBody.includes('TUX_ADMIN_LOYALTY_REASON_INVALID')) {
      sendJson(response, 400, { error: 'invalid_reason_code' });
      return;
    }
    console.error('Admin CRM database request failed', {
      status: error.status,
    });
    sendJson(response, 502, { error: 'admin_backend_unavailable' });
    return;
  }
  console.error('Admin CRM request failed');
  sendJson(response, 500, { error: 'admin_request_failed' });
}

export async function handleCrmRequest(
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
    const service = createCrmService(createCrmStore(client));

    if (request.method === 'GET') {
      const url = new URL(request.url ?? '/', 'http://admin.local');
      const shopId = uuidSchema.parse(url.searchParams.get('shopId'));
      const context = await loadContext(request, client, false);
      switch (url.searchParams.get('view')) {
        case 'customers':
          sendJson(response, 200, {
            customers: await service.listCustomers(
              { shopId, query: url.searchParams.get('q') ?? '' },
              context.principal,
            ),
          });
          return;
        case 'customer': {
          const customerId = uuidSchema.parse(url.searchParams.get('customerId'));
          const customer = await service.getCustomerDetail(
            { shopId, customerId },
            context.principal,
          );
          if (!customer) {
            sendJson(response, 404, { error: 'customer_not_found' });
            return;
          }
          sendJson(response, 200, { customer });
          return;
        }
        case 'loyalty-program':
          sendJson(response, 200, {
            program: await service.getLoyaltyProgram({ shopId }, context.principal),
          });
          return;
        case 'promotions':
          sendJson(response, 200, {
            promotions: await service.listPromotions({ shopId }, context.principal),
          });
          return;
        case 'adjustment-reasons':
          sendJson(response, 200, {
            reasons: await listAdjustmentReasons(client, context, shopId),
          });
          return;
        default:
          sendJson(response, 400, { error: 'invalid_crm_view' });
          return;
      }
    }

    if (!requireSameOrigin(request, response)) return;
    const command = commandSchema.parse(await readJsonObject(request));
    const context = await loadContext(request, client, true);

    switch (command.type) {
      case 'loyalty.program.upsert': {
        const result = await service.upsertLoyaltyProgram(command, context.principal);
        sendJson(response, mutationStatus(result), result);
        return;
      }
      case 'loyalty.adjust': {
        const result = await service.adjustLoyalty(command, context.principal);
        sendJson(response, mutationStatus(result), result);
        return;
      }
      case 'promotion.upsert': {
        const promotion = command.promotion as AdminPromotionUpsertInput;
        const result = await service.upsertPromotion({ ...command, promotion }, context.principal);
        sendJson(response, mutationStatus(result), result);
        return;
      }
    }
  } catch (error) {
    handleFailure(response, error);
  }
}
