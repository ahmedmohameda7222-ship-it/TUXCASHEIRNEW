import type { AdminCustomerIdentity, AdminCustomerMergeResult } from '@tux/admin-contracts';
import { z } from 'zod';

import {
  AdminAuthError,
  loadAdminSession,
  requireSessionCsrf,
  type AdminSessionContext,
} from '../adminAuthService.js';
import { AdminAuthorizationError } from '../authorization.js';
import {
  createCustomerService,
  CustomerServiceError,
  type CustomerStore,
} from './customerService.js';
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

const uuidSchema = z.string().uuid();
const mergeCommandSchema = z
  .object({
    type: z.literal('customer.merge'),
    survivorCustomerId: uuidSchema,
    mergedCustomerId: uuidSchema,
    confirmed: z.boolean(),
    commandId: z.string().trim().min(1).max(160),
  })
  .strict();

type CustomerRow = {
  id: string;
  business_id: string;
  normalized_phone: string;
  display_name: string | null;
  merged_into_customer_id: string | null;
};

function toIdentity(row: CustomerRow): AdminCustomerIdentity {
  return {
    id: row.id,
    businessId: row.business_id,
    normalizedPhone: row.normalized_phone,
    displayName: row.display_name,
    mergedIntoCustomerId: row.merged_into_customer_id,
  };
}

async function assertBusinessShop(
  client: AdminSupabaseClient,
  businessId: string,
  shopId: string,
): Promise<void> {
  const rows = await client.select<Array<{ shop_id: string }>>(
    'business_shops',
    new URLSearchParams({
      select: 'shop_id',
      business_id: `eq.${businessId}`,
      shop_id: `eq.${shopId}`,
      limit: '1',
    }),
  );
  if (rows.length !== 1) throw new AdminAuthorizationError('shop_forbidden');
}

export function createCustomerStore(client: AdminSupabaseClient): CustomerStore {
  return {
    async findByNormalizedPhone(input): Promise<AdminCustomerIdentity | null> {
      await assertBusinessShop(client, input.businessId, input.shopId);
      const rows = await client.select<CustomerRow[]>(
        'business_customers',
        new URLSearchParams({
          select: 'id,business_id,normalized_phone,display_name,merged_into_customer_id',
          business_id: `eq.${input.businessId}`,
          normalized_phone: `eq.${input.normalizedPhone}`,
          limit: '1',
        }),
      );
      const matched = rows[0];
      if (!matched) return null;

      let canonical = matched;
      if (matched.merged_into_customer_id) {
        const survivors = await client.select<CustomerRow[]>(
          'business_customers',
          new URLSearchParams({
            select: 'id,business_id,normalized_phone,display_name,merged_into_customer_id',
            business_id: `eq.${input.businessId}`,
            id: `eq.${matched.merged_into_customer_id}`,
            limit: '1',
          }),
        );
        if (!survivors[0]) return null;
        canonical = survivors[0];
      }

      const links = await client.select<Array<{ id: string }>>(
        'customer_shop_links',
        new URLSearchParams({
          select: 'id',
          business_id: `eq.${input.businessId}`,
          shop_id: `eq.${input.shopId}`,
          canonical_customer_id: `eq.${canonical.id}`,
          limit: '1',
        }),
      );
      return links.length === 1 ? toIdentity(canonical) : null;
    },

    mergeCustomers(input): Promise<AdminCustomerMergeResult> {
      return client.rpc<AdminCustomerMergeResult>('merge_admin_customers_v1', {
        p_employee_id: input.employeeId,
        p_business_id: input.businessId,
        p_survivor_customer_id: input.survivorCustomerId,
        p_merged_customer_id: input.mergedCustomerId,
        p_confirmed: input.confirmed,
        p_command_id: input.commandId,
      });
    },
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

function handleFailure(response: AdminResponse, error: unknown): void {
  if (error instanceof AdminAuthError) {
    sendJson(response, error.status, { error: error.code });
    return;
  }
  if (error instanceof AdminAuthorizationError) {
    sendJson(response, 403, { error: error.code });
    return;
  }
  if (error instanceof CustomerServiceError) {
    sendJson(response, 400, { error: error.code });
    return;
  }
  if (error instanceof z.ZodError) {
    sendJson(response, 400, { error: 'invalid_customers_request' });
    return;
  }
  if (error instanceof AdminSupabaseError) {
    if (error.responseBody.includes('TUX_ADMIN_CUSTOMER_PERMISSION_REQUIRED')) {
      sendJson(response, 403, { error: 'permission_forbidden' });
      return;
    }
    if (error.responseBody.includes('TUX_ADMIN_CUSTOMER_NOT_FOUND')) {
      sendJson(response, 404, { error: 'customer_not_found' });
      return;
    }
    if (
      error.responseBody.includes('TUX_ADMIN_CUSTOMER_COMMAND_CONFLICT') ||
      error.responseBody.includes('TUX_ADMIN_CUSTOMER_ALREADY_MERGED')
    ) {
      sendJson(response, 409, { error: 'customer_merge_conflict' });
      return;
    }
    console.error('Admin customers database request failed', { status: error.status });
    sendJson(response, 502, { error: 'admin_backend_unavailable' });
    return;
  }
  console.error('Admin customers request failed');
  sendJson(response, 500, { error: 'admin_request_failed' });
}

export async function handleCustomersRequest(
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
    const service = createCustomerService(createCustomerStore(client));

    if (request.method === 'GET') {
      const url = new URL(request.url ?? '/', 'http://admin.local');
      const shopId = uuidSchema.parse(url.searchParams.get('shopId'));
      const phone = z.string().min(1).max(40).parse(url.searchParams.get('phone'));
      const context = await loadContext(request, client, false);
      sendJson(response, 200, {
        customer: await service.findByPhone({ shopId, phone }, context.principal),
      });
      return;
    }

    if (!requireSameOrigin(request, response)) return;
    const command = mergeCommandSchema.parse(await readJsonObject(request));
    const context = await loadContext(request, client, true);
    const result = await service.mergeCustomers(command, context.principal);
    sendJson(response, result.ok ? 200 : 409, result);
  } catch (error) {
    handleFailure(response, error);
  }
}
