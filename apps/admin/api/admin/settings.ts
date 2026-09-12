import type { AdminSessionPrincipal, SettingsCommand } from '@tux/admin-contracts';
import { z } from 'zod';

import {
  AdminAuthError,
  loadAdminSession,
  requireSessionCsrf,
} from '../../server/adminAuthService';
import { AdminAuthorizationError } from '../../server/authorization';
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
import {
  createSettingsService,
  createSupabaseSettingsStore,
  SettingsServiceError,
} from '../../server/settings/settingsService';
import { AdminSupabaseClient, AdminSupabaseError } from '../../server/supabaseAdmin';

const uuidSchema = z.string().uuid();
const settingKeySchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z][A-Za-z0-9_.-]*$/)
  .refine((value) => !['__proto__', 'prototype', 'constructor'].includes(value));
const settingValueSchema = z.unknown().refine((value) => value !== undefined);
const expectedRowVersionSchema = z.number().int().positive().nullable();
const expectedSettingsVersionSchema = z.number().int().nonnegative();
const expectedEditVersionSchema = z.number().int().positive();
const sortOrderSchema = z.number().int().nonnegative();
const orderTypeNameSchema = z.string().trim().min(1).max(120);
const paymentMethodNameSchema = z.string().trim().min(1).max(120);
const orderBehaviorSchema = z.enum(['TAKE_AWAY', 'DINE_IN', 'DELIVERY', 'OTHER']);
const paymentChannelSchema = z.enum(['POS', 'ONLINE', 'BOTH']);

export const settingsViewSchema = z.literal('workspace');

export const settingsCommandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('settings.publish'),
      shopId: uuidSchema,
      expectedSettingsVersion: expectedSettingsVersionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('shop.delete-or-archive'),
      shopId: uuidSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('setting.default.upsert'),
      shopId: uuidSchema,
      settingKey: settingKeySchema,
      value: settingValueSchema,
      expectedVersion: expectedRowVersionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('setting.override.upsert'),
      shopId: uuidSchema,
      settingKey: settingKeySchema,
      value: settingValueSchema,
      expectedVersion: expectedRowVersionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('order-type.update'),
      shopId: uuidSchema,
      orderTypeId: uuidSchema,
      name: orderTypeNameSchema,
      behavior: orderBehaviorSchema,
      active: z.boolean(),
      sortOrder: sortOrderSchema,
      expectedSettingsVersion: expectedSettingsVersionSchema,
      expectedEditVersion: expectedEditVersionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('payment-method.update'),
      shopId: uuidSchema,
      paymentMethodId: uuidSchema,
      displayName: paymentMethodNameSchema,
      active: z.boolean(),
      sortOrder: sortOrderSchema,
      channel: paymentChannelSchema,
      requiresReference: z.boolean(),
      manualConfirmationRequired: z.boolean(),
      refundAllowed: z.boolean(),
      expectedSettingsVersion: expectedSettingsVersionSchema,
      expectedEditVersion: expectedEditVersionSchema,
    })
    .strict(),
]);

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

function handleFailure(response: AdminResponse, error: unknown): void {
  if (error instanceof AdminAuthError) {
    sendJson(response, error.status, { error: error.code });
    return;
  }
  if (error instanceof AdminAuthorizationError) {
    sendJson(response, 403, { error: error.code });
    return;
  }
  if (error instanceof SettingsServiceError) {
    sendJson(response, 502, { error: error.code });
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
    console.error('Admin settings database request failed', { status: error.status });
    sendJson(response, 502, { error: 'admin_backend_unavailable' });
    return;
  }
  console.error('Admin settings request failed');
  sendJson(response, 500, { error: 'admin_request_failed' });
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
    const service = createSettingsService(createSupabaseSettingsStore(client));

    if (request.method === 'GET') {
      const requestUrl = new URL(request.url ?? '/', 'http://admin.local');
      const shopId = uuidSchema.safeParse(requestUrl.searchParams.get('shopId'));
      const view = settingsViewSchema.safeParse(requestUrl.searchParams.get('view') ?? 'workspace');
      if (!shopId.success || !view.success) {
        sendJson(response, 400, { error: 'invalid_settings_request' });
        return;
      }
      const principal = await loadPrincipal(request, client, false);
      sendJson(response, 200, { ...(await service.loadSettingsWorkspace(shopId.data, principal)) });
      return;
    }

    if (!requireSameOrigin(request, response)) return;
    const parsed = settingsCommandSchema.safeParse(await readJsonObject(request));
    if (!parsed.success) {
      sendJson(response, 400, { error: 'invalid_settings_request' });
      return;
    }

    const principal = await loadPrincipal(request, client, true);
    const command = parsed.data as SettingsCommand;
    switch (command.type) {
      case 'settings.publish':
        sendJson(response, 200, {
          ...(await service.publishSettings(
            command.shopId,
            command.expectedSettingsVersion,
            principal,
          )),
        });
        return;
      case 'shop.delete-or-archive':
        sendJson(response, 200, {
          ...(await service.deleteOrArchiveShop(command.shopId, principal)),
        });
        return;
      case 'setting.default.upsert':
        sendJson(response, 200, { ...(await service.upsertBusinessDefault(command, principal)) });
        return;
      case 'setting.override.upsert':
        sendJson(response, 200, { ...(await service.upsertShopOverride(command, principal)) });
        return;
      case 'order-type.update':
        sendJson(response, 200, { ...(await service.updateOrderType(command, principal)) });
        return;
      case 'payment-method.update':
        sendJson(response, 200, { ...(await service.updatePaymentMethod(command, principal)) });
        return;
    }
  } catch (error) {
    handleFailure(response, error);
  }
}
