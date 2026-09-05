import {
  assertWhatsAppMessageInvariant,
  normalizeEgyptianPhone,
  parseEntityId,
  type BusinessDayId,
  type DeviceId,
  type OrderId,
  type ShopId,
  type WorkerId,
} from '@tux/domain';
import {
  clearDeviceSession,
  readJsonBody,
  requireDeviceSession,
  requireSameOrigin,
  requireServerConfig,
  sendJson,
  type GatewayRequest,
  type GatewayResponse,
} from './supabaseGateway';
import {
  SupabaseWhatsAppChannelResolver,
  type WhatsAppChannelResolver,
} from './whatsappChannelResolver';
import {
  WhatsAppOperationsRepositoryError,
  type WhatsAppOperationsRepository,
} from './whatsappOperationsRepository';
import { SupabaseWhatsAppOutboundRepository } from './whatsappOutboundRepository';
import { handleWhatsAppOutboundAction } from './whatsappOutboundActions';
import {
  SupabaseWhatsAppOutboundMediaStorage,
  type WhatsAppOutboundMediaStorage,
} from './whatsappOutboundMediaStorage';
import {
  createWhatsAppExtendedProviderGateway,
  type WhatsAppExtendedProviderGateway,
} from './whatsappOutboundProviderGateway';
import { WhatsAppProviderError } from './whatsappProviderGateway';
import { loadWhatsAppDataServerConfig, loadWhatsAppServerConfig } from './whatsappServerConfig';
import {
  OperationsDeviceAuthorityError,
  resolveOperationsDeviceAuthority,
  type OperationsDeviceAuthority,
} from './operationsDeviceAuthority';

export interface WhatsAppOperationsDependencyFactory {
  createRepository(): WhatsAppOperationsRepository;
  createChannelResolver(): WhatsAppChannelResolver;
  createProviderGateway(): WhatsAppExtendedProviderGateway;
  createMediaStorage(): WhatsAppOutboundMediaStorage;
  resolveDeviceAuthority(input: {
    readonly projectUrl: string;
    readonly publishableKey: string;
    readonly accessToken: string;
    readonly deviceId: DeviceId;
  }): Promise<OperationsDeviceAuthority>;
  now(): Date;
}

const productionDependencies: WhatsAppOperationsDependencyFactory = {
  createRepository() {
    return new SupabaseWhatsAppOutboundRepository(loadWhatsAppDataServerConfig());
  },
  createChannelResolver() {
    return new SupabaseWhatsAppChannelResolver(loadWhatsAppDataServerConfig());
  },
  createProviderGateway() {
    const config = loadWhatsAppServerConfig();
    return createWhatsAppExtendedProviderGateway({
      graphVersion: config.graphVersion,
      accessToken: config.accessToken,
    });
  },
  createMediaStorage() {
    return new SupabaseWhatsAppOutboundMediaStorage(loadWhatsAppDataServerConfig());
  },
  resolveDeviceAuthority(input) {
    return resolveOperationsDeviceAuthority(input);
  },
  now() {
    return new Date();
  },
};

const FORBIDDEN_AUTHORITY_FIELDS = new Set([
  'shopId',
  'deviceId',
  'sentByWorkerId',
  'to',
  'providerPhoneNumberId',
  'providerTemplateName',
  'languageCode',
]);

function invalidRequest(response: GatewayResponse): void {
  sendJson(response, 400, { error: 'invalid_whatsapp_request' });
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function validEgyptianPhonePair(
  normalizedPhoneValue: unknown,
  displayPhoneValue: unknown,
): { readonly normalizedPhone: string; readonly displayPhone: string } | null {
  const normalizedPhone = nonEmptyString(normalizedPhoneValue);
  const displayPhone = nonEmptyString(displayPhoneValue);
  if (normalizedPhone === null || displayPhone === null) return null;
  const normalized = normalizeEgyptianPhone(normalizedPhone);
  const display = normalizeEgyptianPhone(displayPhone);
  if (
    !normalized.valid ||
    !display.valid ||
    normalized.normalizedPhone !== normalizedPhone ||
    display.normalizedPhone !== normalizedPhone ||
    normalized.displayPhone !== displayPhone ||
    display.displayPhone !== displayPhone
  ) {
    return null;
  }
  return { normalizedPhone, displayPhone };
}

function isFreeFormOpen(freeFormUntil: string | null, now: Date): boolean {
  if (freeFormUntil === null) return false;
  const expiry = Date.parse(freeFormUntil);
  return Number.isFinite(expiry) && now.getTime() < expiry;
}

function parsedId<T extends ShopId | BusinessDayId | WorkerId | DeviceId | OrderId>(
  value: unknown,
): T | null {
  const raw = nonEmptyString(value);
  if (raw === null) return null;
  try {
    return parseEntityId<T>(raw);
  } catch {
    return null;
  }
}

function parsedUuid(value: unknown): string | null {
  const raw = nonEmptyString(value);
  if (raw === null) return null;
  try {
    return parseEntityId(raw);
  } catch {
    return null;
  }
}

function hasForbiddenAuthorityField(body: Readonly<Record<string, unknown>>): boolean {
  return Object.keys(body).some((key) => FORBIDDEN_AUTHORITY_FIELDS.has(key));
}

function onlyKeys(body: Readonly<Record<string, unknown>>, allowed: readonly string[]): boolean {
  const accepted = new Set(allowed);
  return Object.keys(body).every((key) => accepted.has(key));
}

function sendRepositoryError(response: GatewayResponse, error: unknown): boolean {
  if (!(error instanceof WhatsAppOperationsRepositoryError)) return false;
  if (error.code === 'OPERATOR_NOT_SYNCHRONIZED') {
    sendJson(response, 409, { error: 'whatsapp_operator_not_synchronized' });
    return true;
  }
  if (error.code === 'OUTBOUND_INTENT_CONFLICT') {
    sendJson(response, 409, { error: 'whatsapp_outbound_intent_conflict' });
    return true;
  }
  if (error.code === 'REMOTE_UNAVAILABLE') {
    sendJson(response, 503, { error: 'whatsapp_remote_unavailable' });
    return true;
  }
  sendJson(response, 502, { error: 'whatsapp_remote_rejected' });
  return true;
}

async function handleGet(
  request: GatewayRequest,
  response: GatewayResponse,
  shopId: ShopId,
  dependencies: WhatsAppOperationsDependencyFactory,
): Promise<void> {
  let after: string | null;
  try {
    const requestUrl = new URL(request.url ?? '/api/whatsapp', 'https://tux.invalid');
    const rawAfter = requestUrl.searchParams.get('after');
    after = rawAfter !== null && rawAfter.trim().length === 0 ? null : rawAfter;
  } catch {
    invalidRequest(response);
    return;
  }

  try {
    const snapshot = await dependencies.createRepository().loadInbox({ shopId, after });
    sendJson(response, 200, { ...snapshot });
  } catch (error) {
    if (!sendRepositoryError(response, error)) {
      sendJson(response, 503, { error: 'whatsapp_remote_unavailable' });
    }
  }
}

async function handleResolveTarget(
  body: Readonly<Record<string, unknown>>,
  response: GatewayResponse,
  shopId: ShopId,
  dependencies: WhatsAppOperationsDependencyFactory,
): Promise<void> {
  if (!onlyKeys(body, ['action', 'normalizedPhone', 'displayPhone'])) {
    invalidRequest(response);
    return;
  }
  const phone = validEgyptianPhonePair(body['normalizedPhone'], body['displayPhone']);
  if (phone === null) {
    invalidRequest(response);
    return;
  }

  const repository = dependencies.createRepository();
  try {
    const contact = await repository.resolveContactTarget({
      shopId,
      normalizedPhone: phone.normalizedPhone,
    });
    const policy = await repository.resolveMessagingPolicy({
      shopId,
      conversationId: contact?.conversationId ?? null,
    });

    if (contact !== null) {
      if (
        policy.conversationId !== contact.conversationId ||
        policy.normalizedPhone !== contact.normalizedPhone ||
        policy.displayPhone !== contact.displayPhone
      ) {
        sendJson(response, 502, { error: 'whatsapp_remote_rejected' });
        return;
      }
      if (isFreeFormOpen(policy.freeFormUntil, dependencies.now())) {
        sendJson(response, 200, {
          target: {
            mode: 'FREE_FORM',
            conversationId: contact.conversationId,
            freeFormUntil: policy.freeFormUntil,
            config: policy.config,
          },
        });
        return;
      }
    } else if (
      policy.conversationId !== null ||
      policy.normalizedPhone !== null ||
      policy.displayPhone !== null
    ) {
      sendJson(response, 502, { error: 'whatsapp_remote_rejected' });
      return;
    }

    if (policy.templates.length > 0) {
      sendJson(response, 200, {
        target: {
          mode: 'TEMPLATE_ONLY',
          conversationId: contact?.conversationId ?? null,
          normalizedPhone: phone.normalizedPhone,
          displayPhone: phone.displayPhone,
          templates: policy.templates,
          config: policy.config,
        },
      });
      return;
    }

    sendJson(response, 200, {
      target: {
        mode: 'BLOCKED',
        conversationId: contact?.conversationId ?? null,
        reason: 'NO_APPROVED_TEMPLATE',
        config: policy.config,
      },
    });
  } catch (error) {
    if (!sendRepositoryError(response, error)) {
      sendJson(response, 503, { error: 'whatsapp_remote_unavailable' });
    }
  }
}

async function handleSendMessage(
  body: Readonly<Record<string, unknown>>,
  response: GatewayResponse,
  shopId: ShopId,
  deviceId: DeviceId,
  dependencies: WhatsAppOperationsDependencyFactory,
): Promise<void> {
  if (
    !onlyKeys(body, [
      'action',
      'businessDayId',
      'workerId',
      'conversationId',
      'outboundIntentKey',
      'text',
    ])
  ) {
    invalidRequest(response);
    return;
  }

  const businessDayId = parsedId<BusinessDayId>(body['businessDayId']);
  const workerId = parsedId<WorkerId>(body['workerId']);
  const conversationId = parsedUuid(body['conversationId']);
  const outboundIntentKey = nonEmptyString(body['outboundIntentKey']);
  const text = nonEmptyString(body['text']);
  if (
    businessDayId === null ||
    workerId === null ||
    conversationId === null ||
    outboundIntentKey === null ||
    text === null
  ) {
    invalidRequest(response);
    return;
  }

  const repository = dependencies.createRepository();
  try {
    const currentOperator = await repository.resolveCurrentOperator({
      shopId,
      businessDayId,
      workerId,
    });
    if (currentOperator === null) {
      sendJson(response, 409, { error: 'whatsapp_operator_not_synchronized' });
      return;
    }

    const now = dependencies.now();
    const policy = await repository.resolveMessagingPolicy({ shopId, conversationId });
    if (policy.conversationId !== conversationId || !isFreeFormOpen(policy.freeFormUntil, now)) {
      sendJson(response, 409, { error: 'whatsapp_free_form_window_closed' });
      return;
    }

    const channel = await dependencies.createChannelResolver().resolveOutboundChannel({ shopId });
    if (channel === null) {
      sendJson(response, 503, { error: 'whatsapp_channel_not_configured' });
      return;
    }

    const claim = await repository.claimOutboundTextIntent({
      shopId,
      businessDayId,
      workerId,
      deviceId,
      conversationId,
      outboundIntentKey,
      text,
      initiatedAt: now.toISOString(),
    });

    if (!claim.created) {
      if (claim.message.status === 'PENDING' && claim.message.providerMessageId === null) {
        sendJson(response, 503, {
          error: 'whatsapp_delivery_uncertain',
          messageId: claim.message.id,
        });
        return;
      }
      sendJson(response, 200, { message: claim.message });
      return;
    }

    let providerResult: { readonly providerMessageId: string };
    try {
      providerResult = await dependencies.createProviderGateway().sendMessage({
        providerPhoneNumberId: channel.providerPhoneNumberId,
        to: claim.recipientNormalizedPhone,
        kind: 'TEXT',
        text,
      });
    } catch (error) {
      if (
        error instanceof WhatsAppProviderError &&
        error.httpStatus !== null &&
        error.httpStatus >= 400
      ) {
        const failureCode =
          error.providerCode === null ? `HTTP_${error.httpStatus}` : String(error.providerCode);
        try {
          await repository.failOutboundIntent({
            shopId,
            messageId: claim.message.id,
            failureCode,
            failureMessage: error.safeMessage,
          });
        } catch (failureError) {
          if (!sendRepositoryError(response, failureError)) {
            sendJson(response, 503, {
              error: 'whatsapp_delivery_uncertain',
              messageId: claim.message.id,
            });
          }
          return;
        }
        sendJson(response, 502, {
          error: 'whatsapp_provider_rejected',
          messageId: claim.message.id,
        });
        return;
      }

      sendJson(response, 503, {
        error: 'whatsapp_delivery_uncertain',
        messageId: claim.message.id,
      });
      return;
    }

    try {
      await repository.attachProviderMessage({
        shopId,
        messageId: claim.message.id,
        providerMessageId: providerResult.providerMessageId,
      });
    } catch {
      sendJson(response, 503, {
        error: 'whatsapp_delivery_uncertain',
        messageId: claim.message.id,
      });
      return;
    }

    const sentMessage = {
      ...claim.message,
      providerMessageId: providerResult.providerMessageId,
      status: 'SENT' as const,
    };
    try {
      assertWhatsAppMessageInvariant(sentMessage);
    } catch {
      sendJson(response, 503, {
        error: 'whatsapp_delivery_uncertain',
        messageId: claim.message.id,
      });
      return;
    }
    sendJson(response, 200, { message: sentMessage });
  } catch (error) {
    if (!sendRepositoryError(response, error)) {
      sendJson(response, 503, { error: 'whatsapp_remote_unavailable' });
    }
  }
}

async function handleSendTemplate(
  body: Readonly<Record<string, unknown>>,
  response: GatewayResponse,
  shopId: ShopId,
  deviceId: DeviceId,
  dependencies: WhatsAppOperationsDependencyFactory,
): Promise<void> {
  if (
    !onlyKeys(body, [
      'action',
      'businessDayId',
      'workerId',
      'normalizedPhone',
      'displayPhone',
      'templateId',
      'outboundIntentKey',
    ])
  ) {
    invalidRequest(response);
    return;
  }

  const businessDayId = parsedId<BusinessDayId>(body['businessDayId']);
  const workerId = parsedId<WorkerId>(body['workerId']);
  const phone = validEgyptianPhonePair(body['normalizedPhone'], body['displayPhone']);
  const templateId = parsedUuid(body['templateId']);
  const outboundIntentKey = nonEmptyString(body['outboundIntentKey']);
  if (
    businessDayId === null ||
    workerId === null ||
    phone === null ||
    templateId === null ||
    outboundIntentKey === null
  ) {
    invalidRequest(response);
    return;
  }

  const repository = dependencies.createRepository();
  try {
    const channel = await dependencies.createChannelResolver().resolveOutboundChannel({ shopId });
    if (channel === null) {
      sendJson(response, 503, { error: 'whatsapp_channel_not_configured' });
      return;
    }

    const claim = await repository.claimTemplateIntent({
      shopId,
      businessDayId,
      workerId,
      deviceId,
      normalizedPhone: phone.normalizedPhone,
      displayPhone: phone.displayPhone,
      templateId,
      outboundIntentKey,
      initiatedAt: dependencies.now().toISOString(),
    });

    if (!claim.created) {
      if (claim.message.status === 'PENDING' && claim.message.providerMessageId === null) {
        sendJson(response, 503, {
          error: 'whatsapp_delivery_uncertain',
          messageId: claim.message.id,
        });
        return;
      }
      sendJson(response, 200, { message: claim.message });
      return;
    }

    let providerResult: { readonly providerMessageId: string };
    try {
      providerResult = await dependencies.createProviderGateway().sendMessage({
        providerPhoneNumberId: channel.providerPhoneNumberId,
        to: claim.recipientNormalizedPhone,
        kind: 'TEMPLATE',
        providerTemplateName: claim.providerTemplateName,
        languageCode: claim.languageCode,
      });
    } catch (error) {
      if (
        error instanceof WhatsAppProviderError &&
        error.httpStatus !== null &&
        error.httpStatus >= 400
      ) {
        const failureCode =
          error.providerCode === null ? `HTTP_${error.httpStatus}` : String(error.providerCode);
        try {
          await repository.failOutboundIntent({
            shopId,
            messageId: claim.message.id,
            failureCode,
            failureMessage: error.safeMessage,
          });
        } catch (failureError) {
          if (!sendRepositoryError(response, failureError)) {
            sendJson(response, 503, {
              error: 'whatsapp_delivery_uncertain',
              messageId: claim.message.id,
            });
          }
          return;
        }
        sendJson(response, 502, {
          error: 'whatsapp_provider_rejected',
          messageId: claim.message.id,
        });
        return;
      }
      sendJson(response, 503, {
        error: 'whatsapp_delivery_uncertain',
        messageId: claim.message.id,
      });
      return;
    }

    try {
      await repository.attachProviderMessage({
        shopId,
        messageId: claim.message.id,
        providerMessageId: providerResult.providerMessageId,
      });
    } catch {
      sendJson(response, 503, {
        error: 'whatsapp_delivery_uncertain',
        messageId: claim.message.id,
      });
      return;
    }

    const sentMessage = {
      ...claim.message,
      providerMessageId: providerResult.providerMessageId,
      status: 'SENT' as const,
    };
    try {
      assertWhatsAppMessageInvariant(sentMessage);
    } catch {
      sendJson(response, 503, {
        error: 'whatsapp_delivery_uncertain',
        messageId: claim.message.id,
      });
      return;
    }
    sendJson(response, 200, { message: sentMessage });
  } catch (error) {
    if (!sendRepositoryError(response, error)) {
      sendJson(response, 503, { error: 'whatsapp_remote_unavailable' });
    }
  }
}

async function handleConversationState(
  action: 'MARK_UNREAD' | 'ARCHIVE' | 'FOLLOW_UP',
  body: Readonly<Record<string, unknown>>,
  response: GatewayResponse,
  shopId: ShopId,
  dependencies: WhatsAppOperationsDependencyFactory,
): Promise<void> {
  const allowed =
    action === 'MARK_UNREAD'
      ? ['action', 'conversationId']
      : action === 'ARCHIVE'
        ? ['action', 'conversationId', 'archived']
        : ['action', 'conversationId', 'followUp'];
  if (!onlyKeys(body, allowed)) {
    invalidRequest(response);
    return;
  }

  const conversationId = parsedUuid(body['conversationId']);
  if (conversationId === null) {
    invalidRequest(response);
    return;
  }
  const archived = action === 'ARCHIVE' ? body['archived'] : null;
  const followUp = action === 'FOLLOW_UP' ? body['followUp'] : null;
  if (
    (action === 'ARCHIVE' && typeof archived !== 'boolean') ||
    (action === 'FOLLOW_UP' && typeof followUp !== 'boolean')
  ) {
    invalidRequest(response);
    return;
  }

  try {
    await dependencies.createRepository().setConversationState({
      shopId,
      conversationId,
      archived: action === 'ARCHIVE' ? (archived as boolean) : null,
      followUp: action === 'FOLLOW_UP' ? (followUp as boolean) : null,
      markUnread: action === 'MARK_UNREAD',
    });
    sendJson(response, 200, { status: 'OK' });
  } catch (error) {
    if (!sendRepositoryError(response, error)) {
      sendJson(response, 503, { error: 'whatsapp_remote_unavailable' });
    }
  }
}

async function handleLinkOrder(
  body: Readonly<Record<string, unknown>>,
  response: GatewayResponse,
  shopId: ShopId,
  deviceId: DeviceId,
  dependencies: WhatsAppOperationsDependencyFactory,
): Promise<void> {
  if (
    !onlyKeys(body, ['action', 'businessDayId', 'workerId', 'conversationId', 'orderId', 'linked'])
  ) {
    invalidRequest(response);
    return;
  }
  const businessDayId = parsedId<BusinessDayId>(body['businessDayId']);
  const workerId = parsedId<WorkerId>(body['workerId']);
  const conversationId = parsedUuid(body['conversationId']);
  const orderId = parsedId<OrderId>(body['orderId']);
  const linked = body['linked'] === undefined ? true : body['linked'];
  if (
    businessDayId === null ||
    workerId === null ||
    conversationId === null ||
    orderId === null ||
    typeof linked !== 'boolean'
  ) {
    invalidRequest(response);
    return;
  }

  try {
    await dependencies.createRepository().linkOrderAuthorized({
      shopId,
      businessDayId,
      workerId,
      deviceId,
      conversationId,
      orderId,
      linked,
    });
    sendJson(response, 200, { status: 'OK' });
  } catch (error) {
    if (!sendRepositoryError(response, error)) {
      sendJson(response, 503, { error: 'whatsapp_remote_unavailable' });
    }
  }
}

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function sendAuthorityError(response: GatewayResponse, error: unknown): void {
  if (error instanceof OperationsDeviceAuthorityError && error.code === 'DEVICE_AUTH_INVALID') {
    sendJson(response, 401, { error: 'device_authority_invalid' });
    return;
  }
  sendJson(response, 503, { error: 'device_authority_unavailable' });
}

async function requestAuthority(
  request: GatewayRequest,
  response: GatewayResponse,
  serverConfig: { readonly projectUrl: string; readonly publishableKey: string },
  dependencies: WhatsAppOperationsDependencyFactory,
): Promise<OperationsDeviceAuthority | null> {
  const hasAuthorization = request.headers.authorization !== undefined;
  const hasDeviceHeader = request.headers['x-tux-device-id'] !== undefined;
  if (hasAuthorization || hasDeviceHeader) {
    const authorization = headerValue(request.headers.authorization).trim();
    const rawDeviceId = headerValue(request.headers['x-tux-device-id']).trim();
    const bearer = /^Bearer\s+(\S+)$/i.exec(authorization)?.[1] ?? null;
    const deviceId = parsedId<DeviceId>(rawDeviceId);
    if (bearer === null || deviceId === null) {
      sendJson(response, 401, { error: 'device_authentication_required' });
      return null;
    }
    try {
      return await dependencies.resolveDeviceAuthority({
        projectUrl: serverConfig.projectUrl,
        publishableKey: serverConfig.publishableKey,
        accessToken: bearer,
        deviceId,
      });
    } catch (error) {
      sendAuthorityError(response, error);
      return null;
    }
  }

  const session = await requireDeviceSession(request, response, serverConfig);
  if (session === null) return null;
  const deviceId = parsedId<DeviceId>(session.deviceId);
  const cookieShopId = parsedId<ShopId>(session.shopId);
  if (deviceId === null || cookieShopId === null) {
    clearDeviceSession(response);
    sendJson(response, 401, { error: 'device_session_invalid' });
    return null;
  }

  let authority: OperationsDeviceAuthority;
  try {
    authority = await dependencies.resolveDeviceAuthority({
      projectUrl: serverConfig.projectUrl,
      publishableKey: serverConfig.publishableKey,
      accessToken: session.accessToken,
      deviceId,
    });
  } catch (error) {
    sendAuthorityError(response, error);
    return null;
  }
  if (authority.shopId !== cookieShopId || authority.deviceId !== deviceId) {
    clearDeviceSession(response);
    sendJson(response, 401, { error: 'device_session_invalid' });
    return null;
  }
  return authority;
}

export async function handleWhatsAppOperations(
  request: GatewayRequest,
  response: GatewayResponse,
  dependencies: WhatsAppOperationsDependencyFactory = productionDependencies,
): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'POST') {
    sendJson(response, 405, { error: 'method_not_allowed' });
    return;
  }

  const serverConfig = requireServerConfig(response);
  if (serverConfig === null) return;
  const authority = await requestAuthority(request, response, serverConfig, dependencies);
  if (authority === null) return;
  const { shopId, deviceId } = authority;

  if (request.method === 'GET') {
    await handleGet(request, response, shopId, dependencies);
    return;
  }
  if (!requireSameOrigin(request, response)) return;

  let body: Readonly<Record<string, unknown>>;
  try {
    body = await readJsonBody(request);
  } catch {
    invalidRequest(response);
    return;
  }
  if (hasForbiddenAuthorityField(body)) {
    invalidRequest(response);
    return;
  }

  const action = nonEmptyString(body['action']);
  if (
    action !== null &&
    (await handleWhatsAppOutboundAction({
      action,
      body,
      response,
      shopId,
      deviceId,
      dependencies,
    }))
  ) {
    return;
  }
  if (action === 'RESOLVE_TARGET') {
    await handleResolveTarget(body, response, shopId, dependencies);
    return;
  }
  if (action === 'SEND_MESSAGE') {
    await handleSendMessage(body, response, shopId, deviceId, dependencies);
    return;
  }
  if (action === 'SEND_TEMPLATE') {
    await handleSendTemplate(body, response, shopId, deviceId, dependencies);
    return;
  }
  if (action === 'MARK_UNREAD' || action === 'ARCHIVE' || action === 'FOLLOW_UP') {
    await handleConversationState(action, body, response, shopId, dependencies);
    return;
  }
  if (action === 'LINK_ORDER') {
    await handleLinkOrder(body, response, shopId, deviceId, dependencies);
    return;
  }
  invalidRequest(response);
}
