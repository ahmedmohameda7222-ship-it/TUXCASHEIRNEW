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
import { updateShopOperationalState } from '../../server/settings/settingsOperationalState';
import {
  createSettingsService,
  createSupabaseSettingsStore,
  SettingsServiceError,
} from '../../server/settings/settingsService';
import {
  updateShopIdentity,
  upsertShopSpecialHours,
  upsertShopWeeklyHours,
} from '../../server/settings/settingsShopManagement';
import { AdminSupabaseClient, AdminSupabaseError } from '../../server/supabaseAdmin';

const POSTGRES_INTEGER_MAX = 2_147_483_647;
const uuidSchema = z.string().uuid();
const expectedRowVersionSchema = z.number().int().positive().nullable();
const expectedSettingsVersionSchema = z.number().int().nonnegative();
const expectedEditVersionSchema = z.number().int().positive();
const sortOrderSchema = z.number().int().nonnegative();
const orderTypeNameSchema = z.string().trim().min(1).max(120);
const paymentMethodNameSchema = z.string().trim().min(1).max(120);
const orderBehaviorSchema = z.enum(['TAKE_AWAY', 'DINE_IN', 'DELIVERY', 'OTHER']);
const paymentChannelSchema = z.enum(['POS', 'ONLINE', 'BOTH']);
const serviceKindSchema = z.enum(['OPEN', 'DELIVERY', 'ONLINE']);
const localTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?$/);
const serviceDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const reasonFamilySchema = z.enum([
  'CANCELLATION', 'REFUND_RETURN', 'DISCOUNT_COMP', 'WASTE',
  'STOCK_ADJUSTMENT', 'CASH_VARIANCE', 'PAY_IN', 'PAY_OUT',
]);
const reasonKeySchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/).max(120);
const reasonLabelSchema = z.string().trim().min(1).max(240);

const settingValueSchemas = {
  'checkout.minimumOrderMinor': z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  'checkout.serviceChargeBps': z.number().int().min(0).max(10_000),
  'checkout.taxBps': z.number().int().min(0).max(10_000),
  'checkout.allowDiscountStacking': z.boolean(),
  'checkout.allowDeliveryFeeOverride': z.boolean(),
  'checkout.requireCustomerPhone': z.boolean(),
  'receipt.orderPrefix': z.string().max(64),
  'receipt.footer': z.string().max(1_000),
  'receipt.sequenceStart': z.number().int().positive().max(POSTGRES_INTEGER_MAX),
  'receipt.sequenceResetPolicy': z.literal('BUSINESS_DAY'),
} as const;

type SupportedSettingKey = keyof typeof settingValueSchemas;
const supportedSettingKeys = Object.keys(settingValueSchemas) as [SupportedSettingKey, ...SupportedSettingKey[]];
const settingKeySchema = z.enum(supportedSettingKeys);

function settingWriteCommandSchema(type: 'setting.default.upsert' | 'setting.override.upsert') {
  return z.object({
    type: z.literal(type),
    shopId: uuidSchema,
    settingKey: settingKeySchema,
    value: z.unknown(),
    expectedVersion: expectedRowVersionSchema,
  }).strict().superRefine((command, context) => {
    const result = settingValueSchemas[command.settingKey].safeParse(command.value);
    if (!result.success) {
      context.addIssue({ code: 'custom', path: ['value'], message: `Invalid value for ${command.settingKey}` });
    }
  });
}

const reasonCodeWriteCommandSchema = z.object({
  type: z.literal('reason-code.upsert'),
  shopId: uuidSchema,
  reasonCodeId: uuidSchema.nullable(),
  key: reasonKeySchema,
  family: reasonFamilySchema,
  label: reasonLabelSchema,
  active: z.boolean(),
  expectedVersion: expectedRowVersionSchema,
}).strict().superRefine((command, context) => {
  const creating = command.reasonCodeId === null;
  if ((creating && command.expectedVersion !== null) || (!creating && command.expectedVersion === null)) {
    context.addIssue({ code: 'custom', path: ['expectedVersion'], message: 'Reason-code create/edit version fence is inconsistent.' });
  }
});

const weeklyExpectedRowSchema = z.object({
  serviceKind: serviceKindSchema,
  dayOfWeek: z.number().int().min(0).max(6),
  opensLocal: localTimeSchema,
  closesLocal: localTimeSchema,
  active: z.boolean(),
}).strict();

const specialExpectedRowSchema = z.object({
  serviceDate: serviceDateSchema,
  serviceKind: serviceKindSchema,
  closed: z.boolean(),
  opensLocal: localTimeSchema.nullable(),
  closesLocal: localTimeSchema.nullable(),
  note: z.string().max(500).nullable(),
}).strict();

export const settingsViewSchema = z.literal('workspace');

export const settingsCommandSchema = z.union([
  z.object({ type: z.literal('settings.publish'), shopId: uuidSchema, expectedSettingsVersion: expectedSettingsVersionSchema }).strict(),
  z.object({
    type: z.literal('shop.operational-state.update'), shopId: uuidSchema,
    temporaryClosed: z.boolean(), onlineOrdersPaused: z.boolean(),
    expectedSettingsVersion: expectedSettingsVersionSchema,
  }).strict(),
  z.object({
    type: z.literal('shop.identity.update'),
    shopId: uuidSchema,
    name: z.string().trim().min(1).max(160),
    address: z.string().trim().max(500).nullable(),
    contactPhone: z.string().trim().max(80).nullable(),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    expectedSettingsVersion: expectedSettingsVersionSchema,
    expectedIdentity: z.object({
      name: z.string(),
      address: z.string().nullable(),
      contactPhone: z.string().nullable(),
      latitude: z.number().nullable(),
      longitude: z.number().nullable(),
    }).strict(),
  }).strict().superRefine((command, context) => {
    if ((command.latitude === null) !== (command.longitude === null)) {
      context.addIssue({ code: 'custom', path: ['latitude'], message: 'Latitude and longitude must be supplied together.' });
    }
  }),
  z.object({
    type: z.literal('shop.weekly-hours.upsert'),
    shopId: uuidSchema,
    hoursId: uuidSchema.nullable(),
    serviceKind: serviceKindSchema,
    dayOfWeek: z.number().int().min(0).max(6),
    opensLocal: localTimeSchema,
    closesLocal: localTimeSchema,
    active: z.boolean(),
    expectedSettingsVersion: expectedSettingsVersionSchema,
    expectedRow: weeklyExpectedRowSchema.nullable(),
  }).strict().superRefine((command, context) => {
    if ((command.hoursId === null) !== (command.expectedRow === null)) {
      context.addIssue({ code: 'custom', path: ['expectedRow'], message: 'Weekly-hours row fence is inconsistent.' });
    }
    if (command.opensLocal === command.closesLocal) {
      context.addIssue({ code: 'custom', path: ['closesLocal'], message: 'Opening and closing time must differ.' });
    }
  }),
  z.object({
    type: z.literal('shop.special-hours.upsert'),
    shopId: uuidSchema,
    hoursId: uuidSchema.nullable(),
    serviceDate: serviceDateSchema,
    serviceKind: serviceKindSchema,
    closed: z.boolean(),
    opensLocal: localTimeSchema.nullable(),
    closesLocal: localTimeSchema.nullable(),
    note: z.string().trim().max(500).nullable(),
    active: z.boolean(),
    expectedSettingsVersion: expectedSettingsVersionSchema,
    expectedRow: specialExpectedRowSchema.nullable(),
  }).strict().superRefine((command, context) => {
    if ((command.hoursId === null) !== (command.expectedRow === null)) {
      context.addIssue({ code: 'custom', path: ['expectedRow'], message: 'Special-hours row fence is inconsistent.' });
    }
    if (command.hoursId === null && !command.active) {
      context.addIssue({ code: 'custom', path: ['active'], message: 'A new special-hours row must be active.' });
    }
    if (command.active && command.closed && (command.opensLocal !== null || command.closesLocal !== null)) {
      context.addIssue({ code: 'custom', path: ['opensLocal'], message: 'Closed special dates cannot have service times.' });
    }
    if (command.active && !command.closed && (command.opensLocal === null || command.closesLocal === null || command.opensLocal === command.closesLocal)) {
      context.addIssue({ code: 'custom', path: ['opensLocal'], message: 'Open special dates require distinct opening and closing times.' });
    }
  }),
  z.object({ type: z.literal('shop.delete-or-archive'), shopId: uuidSchema }).strict(),
  settingWriteCommandSchema('setting.default.upsert'),
  settingWriteCommandSchema('setting.override.upsert'),
  reasonCodeWriteCommandSchema,
  z.object({
    type: z.literal('order-type.update'), shopId: uuidSchema, orderTypeId: uuidSchema,
    name: orderTypeNameSchema, behavior: orderBehaviorSchema, active: z.boolean(),
    sortOrder: sortOrderSchema, expectedSettingsVersion: expectedSettingsVersionSchema,
    expectedEditVersion: expectedEditVersionSchema,
  }).strict(),
  z.object({
    type: z.literal('payment-method.update'), shopId: uuidSchema, paymentMethodId: uuidSchema,
    displayName: paymentMethodNameSchema, active: z.boolean(), sortOrder: sortOrderSchema,
    channel: paymentChannelSchema, requiresReference: z.boolean(), manualConfirmationRequired: z.boolean(),
    refundAllowed: z.boolean(), expectedSettingsVersion: expectedSettingsVersionSchema,
    expectedEditVersion: expectedEditVersionSchema,
  }).strict(),
]);

async function loadPrincipal(request: AdminRequest, client: AdminSupabaseClient, csrfRequired: boolean): Promise<AdminSessionPrincipal> {
  const token = readAdminSessionToken(firstHeader(request.headers.cookie));
  if (!token) throw new AdminAuthError('session_required', 401);
  const context = await loadAdminSession(token, client);
  if (csrfRequired) requireSessionCsrf(context, firstHeader(request.headers['x-tux-admin-csrf']).trim());
  return context.principal;
}

function handleFailure(response: AdminResponse, error: unknown): void {
  if (error instanceof AdminAuthError) { sendJson(response, error.status, { error: error.code }); return; }
  if (error instanceof AdminAuthorizationError) { sendJson(response, 403, { error: error.code }); return; }
  if (error instanceof SettingsServiceError) { sendJson(response, 502, { error: error.code }); return; }
  if (error instanceof AdminSupabaseError) {
    if (error.responseBody.includes('TUX_ADMIN_SETTINGS_FORBIDDEN') || error.responseBody.includes('TUX_ADMIN_SETTINGS_SHOP_FORBIDDEN')) {
      sendJson(response, 403, { error: 'permission_forbidden' }); return;
    }
    console.error('Admin settings database request failed', { status: error.status });
    sendJson(response, 502, { error: 'admin_backend_unavailable' }); return;
  }
  console.error('Admin settings request failed');
  sendJson(response, 500, { error: 'admin_request_failed' });
}

export default async function handler(request: AdminRequest, response: AdminResponse): Promise<void> {
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
      if (!shopId.success || !view.success) { sendJson(response, 400, { error: 'invalid_settings_request' }); return; }
      const principal = await loadPrincipal(request, client, false);
      sendJson(response, 200, { ...(await service.loadSettingsWorkspace(shopId.data, principal)) });
      return;
    }

    if (!requireSameOrigin(request, response)) return;
    const parsed = settingsCommandSchema.safeParse(await readJsonObject(request));
    if (!parsed.success) { sendJson(response, 400, { error: 'invalid_settings_request' }); return; }
    const principal = await loadPrincipal(request, client, true);
    const command = parsed.data as SettingsCommand;

    switch (command.type) {
      case 'settings.publish':
        sendJson(response, 200, { ...(await service.publishSettings(command.shopId, command.expectedSettingsVersion, principal)) }); return;
      case 'shop.operational-state.update':
        sendJson(response, 200, { ...(await updateShopOperationalState(client, command, principal)) }); return;
      case 'shop.identity.update':
        sendJson(response, 200, { ...(await updateShopIdentity(client, command, principal)) }); return;
      case 'shop.weekly-hours.upsert':
        sendJson(response, 200, { ...(await upsertShopWeeklyHours(client, command, principal)) }); return;
      case 'shop.special-hours.upsert':
        sendJson(response, 200, { ...(await upsertShopSpecialHours(client, command, principal)) }); return;
      case 'shop.delete-or-archive':
        sendJson(response, 200, { ...(await service.deleteOrArchiveShop(command.shopId, principal)) }); return;
      case 'setting.default.upsert':
        sendJson(response, 200, { ...(await service.upsertBusinessDefault(command, principal)) }); return;
      case 'setting.override.upsert':
        sendJson(response, 200, { ...(await service.upsertShopOverride(command, principal)) }); return;
      case 'reason-code.upsert':
        sendJson(response, 200, { ...(await service.upsertReasonCode(command, principal)) }); return;
      case 'order-type.update':
        sendJson(response, 200, { ...(await service.updateOrderType(command, principal)) }); return;
      case 'payment-method.update':
        sendJson(response, 200, { ...(await service.updatePaymentMethod(command, principal)) }); return;
    }
  } catch (error) {
    handleFailure(response, error);
  }
}