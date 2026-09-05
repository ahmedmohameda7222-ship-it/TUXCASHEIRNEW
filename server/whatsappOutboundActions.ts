import { createHash } from 'node:crypto';
import {
  assertWhatsAppMessageInvariant,
  parseEntityId,
  type BusinessDayId,
  type DeviceId,
  type ShopId,
  type WhatsAppLocationPayload,
  type WhatsAppMessage,
  type WorkerId,
} from '@tux/domain';
import type { WhatsAppChannelResolver } from './whatsappChannelResolver';
import {
  validateWhatsAppMediaContent,
  WHATSAPP_MEDIA_LIMITS,
  WHATSAPP_MEDIA_MIME_TYPES,
  type WhatsAppMediaKind,
} from './whatsappMediaPolicy';
import type { WhatsAppOutboundMediaStorage } from './whatsappOutboundMediaStorage';
import type { WhatsAppOutboundRepository } from './whatsappOutboundRepository';
import type { WhatsAppOperationsRepository } from './whatsappOperationsRepository';
import { WhatsAppOperationsRepositoryError } from './whatsappOperationsRepository';
import type { WhatsAppExtendedProviderGateway } from './whatsappOutboundProviderGateway';
import { WhatsAppProviderError } from './whatsappProviderGateway';
import { sendJson, type GatewayResponse } from './supabaseGateway';

export interface WhatsAppOutboundActionDependencies {
  createRepository(): WhatsAppOperationsRepository & Partial<WhatsAppOutboundRepository>;
  createChannelResolver(): WhatsAppChannelResolver;
  createProviderGateway(): WhatsAppExtendedProviderGateway;
  createMediaStorage(): WhatsAppOutboundMediaStorage;
  now(): Date;
}

interface ActionContext {
  readonly action: string;
  readonly body: Readonly<Record<string, unknown>>;
  readonly response: GatewayResponse;
  readonly shopId: ShopId;
  readonly deviceId: DeviceId;
  readonly dependencies: WhatsAppOutboundActionDependencies;
}

interface WorkerClaims {
  readonly businessDayId: BusinessDayId;
  readonly workerId: WorkerId;
}

const MEDIA_ACTIONS = new Set([
  'CREATE_MEDIA_UPLOAD',
  'FINALIZE_MEDIA_SEND',
  'SEND_LOCATION',
  'RETRY_FAILED',
  'GET_MEDIA_ACCESS',
]);

function invalidRequest(response: GatewayResponse): void {
  sendJson(response, 400, { error: 'invalid_whatsapp_request' });
}

function requiredString(value: unknown, maxLength = 512): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null;
}

function optionalString(value: unknown, maxLength: number): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLength) return undefined;
  for (const character of trimmed) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return undefined;
  }
  return trimmed;
}

function parsedId<T extends BusinessDayId | WorkerId>(value: unknown): T | null {
  const raw = requiredString(value, 64);
  if (raw === null) return null;
  try {
    return parseEntityId<T>(raw);
  } catch {
    return null;
  }
}

function parsedUuid(value: unknown): string | null {
  const raw = requiredString(value, 64);
  if (raw === null) return null;
  try {
    return parseEntityId(raw);
  } catch {
    return null;
  }
}

function onlyKeys(body: Readonly<Record<string, unknown>>, allowed: readonly string[]): boolean {
  const accepted = new Set(allowed);
  return Object.keys(body).every((key) => accepted.has(key));
}

function mediaKind(value: unknown): WhatsAppMediaKind | null {
  return value === 'IMAGE' || value === 'DOCUMENT' || value === 'AUDIO' ? value : null;
}

function mediaDeclaration(body: Readonly<Record<string, unknown>>): {
  readonly kind: WhatsAppMediaKind;
  readonly mimeType: string;
  readonly fileName: string | null;
  readonly byteSize: number;
} | null {
  const kind = mediaKind(body['kind']);
  const mimeType = requiredString(body['mimeType'], 160);
  const fileName = optionalString(body['fileName'], 255);
  const byteSize = body['byteSize'];
  if (
    kind === null ||
    mimeType === null ||
    fileName === undefined ||
    typeof byteSize !== 'number' ||
    !Number.isSafeInteger(byteSize) ||
    byteSize < 0
  ) {
    return null;
  }
  const allowed = WHATSAPP_MEDIA_MIME_TYPES[kind] as readonly string[];
  if (!allowed.includes(mimeType) || byteSize > WHATSAPP_MEDIA_LIMITS[kind]) return null;
  return { kind, mimeType, fileName, byteSize };
}

function workerClaims(body: Readonly<Record<string, unknown>>): WorkerClaims | null {
  const businessDayId = parsedId<BusinessDayId>(body['businessDayId']);
  const workerId = parsedId<WorkerId>(body['workerId']);
  return businessDayId === null || workerId === null ? null : { businessDayId, workerId };
}

function deterministicMediaKey(shopId: ShopId, outboundIntentKey: string): string {
  return createHash('sha256').update(`outbound:${shopId}:${outboundIntentKey}`).digest('hex');
}

function freeFormOpen(freeFormUntil: string | null, now: Date): boolean {
  if (freeFormUntil === null) return false;
  const expiry = Date.parse(freeFormUntil);
  return Number.isFinite(expiry) && now.getTime() < expiry;
}

function outboundRepository(
  repository: WhatsAppOperationsRepository & Partial<WhatsAppOutboundRepository>,
): WhatsAppOperationsRepository & WhatsAppOutboundRepository {
  const candidate = repository as WhatsAppOperationsRepository & WhatsAppOutboundRepository;
  if (
    typeof candidate.claimOutboundMediaIntent !== 'function' ||
    typeof candidate.claimOutboundLocationIntent !== 'function' ||
    typeof candidate.resolveRetryableMessage !== 'function' ||
    typeof candidate.claimRetryIntent !== 'function' ||
    typeof candidate.resolveMediaAccess !== 'function'
  ) {
    throw new Error('WhatsApp outbound repository is unavailable.');
  }
  return candidate;
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

async function verifyWorkerAndWindow(input: {
  readonly repository: WhatsAppOperationsRepository;
  readonly shopId: ShopId;
  readonly conversationId: string;
  readonly claims: WorkerClaims;
  readonly now: Date;
  readonly response: GatewayResponse;
}): Promise<boolean> {
  const operator = await input.repository.resolveCurrentOperator({
    shopId: input.shopId,
    businessDayId: input.claims.businessDayId,
    workerId: input.claims.workerId,
  });
  if (operator === null) {
    sendJson(input.response, 409, { error: 'whatsapp_operator_not_synchronized' });
    return false;
  }
  const policy = await input.repository.resolveMessagingPolicy({
    shopId: input.shopId,
    conversationId: input.conversationId,
  });
  if (
    policy.conversationId !== input.conversationId ||
    !freeFormOpen(policy.freeFormUntil, input.now)
  ) {
    sendJson(input.response, 409, { error: 'whatsapp_free_form_window_closed' });
    return false;
  }
  return true;
}

async function outboundChannel(
  dependencies: WhatsAppOutboundActionDependencies,
  shopId: ShopId,
  response: GatewayResponse,
) {
  const channel = await dependencies.createChannelResolver().resolveOutboundChannel({ shopId });
  if (channel === null) {
    sendJson(response, 503, { error: 'whatsapp_channel_not_configured' });
    return null;
  }
  return channel;
}

function existingClaimResponse(response: GatewayResponse, message: WhatsAppMessage): boolean {
  if (message.status === 'PENDING' && message.providerMessageId === null) {
    sendJson(response, 503, { error: 'whatsapp_delivery_uncertain', messageId: message.id });
    return true;
  }
  sendJson(response, 200, { message });
  return true;
}

async function markProviderFailure(input: {
  readonly repository: WhatsAppOperationsRepository;
  readonly shopId: ShopId;
  readonly messageId: string;
  readonly error: WhatsAppProviderError;
  readonly response: GatewayResponse;
}): Promise<void> {
  const failureCode =
    input.error.providerCode === null
      ? `HTTP_${input.error.httpStatus}`
      : String(input.error.providerCode);
  try {
    await input.repository.failOutboundIntent({
      shopId: input.shopId,
      messageId: input.messageId,
      failureCode,
      failureMessage: input.error.safeMessage,
    });
  } catch (error) {
    if (!sendRepositoryError(input.response, error)) {
      sendJson(input.response, 503, {
        error: 'whatsapp_delivery_uncertain',
        messageId: input.messageId,
      });
    }
    return;
  }
  sendJson(input.response, 502, {
    error: 'whatsapp_provider_rejected',
    messageId: input.messageId,
  });
}

async function sendClaimedProviderMessage(input: {
  readonly repository: WhatsAppOperationsRepository;
  readonly provider: WhatsAppExtendedProviderGateway;
  readonly providerInput: Parameters<WhatsAppExtendedProviderGateway['sendMessage']>[0];
  readonly shopId: ShopId;
  readonly message: WhatsAppMessage;
  readonly response: GatewayResponse;
}): Promise<void> {
  let providerResult: { readonly providerMessageId: string };
  try {
    providerResult = await input.provider.sendMessage(input.providerInput);
  } catch (error) {
    if (
      error instanceof WhatsAppProviderError &&
      error.httpStatus !== null &&
      error.httpStatus >= 400
    ) {
      await markProviderFailure({
        repository: input.repository,
        shopId: input.shopId,
        messageId: input.message.id,
        error,
        response: input.response,
      });
      return;
    }
    sendJson(input.response, 503, {
      error: 'whatsapp_delivery_uncertain',
      messageId: input.message.id,
    });
    return;
  }

  try {
    await input.repository.attachProviderMessage({
      shopId: input.shopId,
      messageId: input.message.id,
      providerMessageId: providerResult.providerMessageId,
    });
  } catch {
    sendJson(input.response, 503, {
      error: 'whatsapp_delivery_uncertain',
      messageId: input.message.id,
    });
    return;
  }

  const sentMessage: WhatsAppMessage = {
    ...input.message,
    providerMessageId: providerResult.providerMessageId,
    status: 'SENT',
  };
  try {
    assertWhatsAppMessageInvariant(sentMessage);
  } catch {
    sendJson(input.response, 503, {
      error: 'whatsapp_delivery_uncertain',
      messageId: input.message.id,
    });
    return;
  }
  sendJson(input.response, 200, { message: sentMessage });
}

async function createMediaUpload(context: ActionContext): Promise<void> {
  if (
    !onlyKeys(context.body, [
      'action',
      'businessDayId',
      'workerId',
      'conversationId',
      'outboundIntentKey',
      'kind',
      'mimeType',
      'fileName',
      'byteSize',
    ])
  ) {
    invalidRequest(context.response);
    return;
  }
  const claims = workerClaims(context.body);
  const conversationId = parsedUuid(context.body['conversationId']);
  const outboundIntentKey = requiredString(context.body['outboundIntentKey'], 200);
  const media = mediaDeclaration(context.body);
  if (
    claims === null ||
    conversationId === null ||
    outboundIntentKey === null ||
    media === null
  ) {
    invalidRequest(context.response);
    return;
  }

  const repository = context.dependencies.createRepository();
  try {
    const allowed = await verifyWorkerAndWindow({
      repository,
      shopId: context.shopId,
      conversationId,
      claims,
      now: context.dependencies.now(),
      response: context.response,
    });
    if (!allowed) return;
    const mediaKey = deterministicMediaKey(context.shopId, outboundIntentKey);
    const upload = await context.dependencies.createMediaStorage().createSignedUpload({
      shopId: context.shopId,
      mediaKey,
      fileName: media.fileName,
    });
    sendJson(context.response, 200, { upload: { mediaKey, uploadUrl: upload.url } });
  } catch (error) {
    if (!sendRepositoryError(context.response, error)) {
      sendJson(context.response, 503, { error: 'whatsapp_remote_unavailable' });
    }
  }
}

async function finalizeMediaSend(context: ActionContext): Promise<void> {
  if (
    !onlyKeys(context.body, [
      'action',
      'businessDayId',
      'workerId',
      'conversationId',
      'outboundIntentKey',
      'mediaKey',
      'kind',
      'mimeType',
      'fileName',
      'byteSize',
    ])
  ) {
    invalidRequest(context.response);
    return;
  }
  const claims = workerClaims(context.body);
  const conversationId = parsedUuid(context.body['conversationId']);
  const outboundIntentKey = requiredString(context.body['outboundIntentKey'], 200);
  const suppliedMediaKey = requiredString(context.body['mediaKey'], 128);
  const media = mediaDeclaration(context.body);
  if (
    claims === null ||
    conversationId === null ||
    outboundIntentKey === null ||
    suppliedMediaKey === null ||
    media === null ||
    suppliedMediaKey !== deterministicMediaKey(context.shopId, outboundIntentKey)
  ) {
    invalidRequest(context.response);
    return;
  }

  const baseRepository = context.dependencies.createRepository();
  let repository: WhatsAppOperationsRepository & WhatsAppOutboundRepository;
  try {
    repository = outboundRepository(baseRepository);
    const allowed = await verifyWorkerAndWindow({
      repository,
      shopId: context.shopId,
      conversationId,
      claims,
      now: context.dependencies.now(),
      response: context.response,
    });
    if (!allowed) return;

    const storage = context.dependencies.createMediaStorage();
    const inspected = await storage.inspectUploadedMedia({
      shopId: context.shopId,
      mediaKey: suppliedMediaKey,
      kind: media.kind,
      mimeType: media.mimeType,
      byteSize: media.byteSize,
    });
    const validation = validateWhatsAppMediaContent({
      kind: media.kind,
      mimeType: media.mimeType,
      byteSize: inspected.byteSize,
      prefix: inspected.prefix,
    });
    const expectedPath = `media/${context.shopId}/${suppliedMediaKey}`;
    if (
      !validation.ok ||
      inspected.byteSize !== media.byteSize ||
      inspected.objectPath !== expectedPath
    ) {
      invalidRequest(context.response);
      return;
    }

    const claim = await repository.claimOutboundMediaIntent({
      shopId: context.shopId,
      businessDayId: claims.businessDayId,
      workerId: claims.workerId,
      deviceId: context.deviceId,
      conversationId,
      outboundIntentKey,
      media: {
        mediaKey: suppliedMediaKey,
        kind: media.kind,
        objectPath: inspected.objectPath,
        mimeType: media.mimeType,
        fileName: media.fileName,
        byteSize: inspected.byteSize,
        sha256: inspected.sha256,
        storedAt: inspected.storedAt,
        expiresAt: inspected.expiresAt,
      },
      initiatedAt: context.dependencies.now().toISOString(),
    });
    if (!claim.created) {
      existingClaimResponse(context.response, claim.message);
      return;
    }

    const channel = await outboundChannel(context.dependencies, context.shopId, context.response);
    if (channel === null) return;
    const access = await storage.createSignedDownload({
      objectPath: inspected.objectPath,
      expiresAt: inspected.expiresAt,
    });
    if (access.status !== 'AVAILABLE') {
      sendJson(context.response, 503, {
        error: 'whatsapp_delivery_uncertain',
        messageId: claim.message.id,
      });
      return;
    }
    await sendClaimedProviderMessage({
      repository,
      provider: context.dependencies.createProviderGateway(),
      providerInput: {
        providerPhoneNumberId: channel.providerPhoneNumberId,
        to: claim.recipientNormalizedPhone,
        kind: media.kind,
        mediaUrl: access.url,
        fileName: media.fileName,
      },
      shopId: context.shopId,
      message: claim.message,
      response: context.response,
    });
  } catch (error) {
    if (!sendRepositoryError(context.response, error)) {
      sendJson(context.response, 503, { error: 'whatsapp_remote_unavailable' });
    }
  }
}

function locationPayload(body: Readonly<Record<string, unknown>>): WhatsAppLocationPayload | null {
  const latitude = body['latitude'];
  const longitude = body['longitude'];
  const name = optionalString(body['name'], 256);
  const address = optionalString(body['address'], 512);
  if (
    typeof latitude !== 'number' ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    typeof longitude !== 'number' ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    name === undefined ||
    address === undefined
  ) {
    return null;
  }
  return { latitude, longitude, name, address };
}

async function sendLocation(context: ActionContext): Promise<void> {
  if (
    !onlyKeys(context.body, [
      'action',
      'businessDayId',
      'workerId',
      'conversationId',
      'outboundIntentKey',
      'latitude',
      'longitude',
      'name',
      'address',
    ])
  ) {
    invalidRequest(context.response);
    return;
  }
  const claims = workerClaims(context.body);
  const conversationId = parsedUuid(context.body['conversationId']);
  const outboundIntentKey = requiredString(context.body['outboundIntentKey'], 200);
  const location = locationPayload(context.body);
  if (
    claims === null ||
    conversationId === null ||
    outboundIntentKey === null ||
    location === null
  ) {
    invalidRequest(context.response);
    return;
  }

  try {
    const repository = outboundRepository(context.dependencies.createRepository());
    const allowed = await verifyWorkerAndWindow({
      repository,
      shopId: context.shopId,
      conversationId,
      claims,
      now: context.dependencies.now(),
      response: context.response,
    });
    if (!allowed) return;
    const channel = await outboundChannel(context.dependencies, context.shopId, context.response);
    if (channel === null) return;
    const claim = await repository.claimOutboundLocationIntent({
      shopId: context.shopId,
      businessDayId: claims.businessDayId,
      workerId: claims.workerId,
      deviceId: context.deviceId,
      conversationId,
      outboundIntentKey,
      location,
      initiatedAt: context.dependencies.now().toISOString(),
    });
    if (!claim.created) {
      existingClaimResponse(context.response, claim.message);
      return;
    }
    await sendClaimedProviderMessage({
      repository,
      provider: context.dependencies.createProviderGateway(),
      providerInput: {
        providerPhoneNumberId: channel.providerPhoneNumberId,
        to: claim.recipientNormalizedPhone,
        kind: 'LOCATION',
        ...location,
      },
      shopId: context.shopId,
      message: claim.message,
      response: context.response,
    });
  } catch (error) {
    if (!sendRepositoryError(context.response, error)) {
      sendJson(context.response, 503, { error: 'whatsapp_remote_unavailable' });
    }
  }
}

async function retryFailed(context: ActionContext): Promise<void> {
  if (
    !onlyKeys(context.body, [
      'action',
      'businessDayId',
      'workerId',
      'messageId',
      'outboundIntentKey',
    ])
  ) {
    invalidRequest(context.response);
    return;
  }
  const claims = workerClaims(context.body);
  const messageId = parsedUuid(context.body['messageId']);
  const outboundIntentKey = requiredString(context.body['outboundIntentKey'], 200);
  if (claims === null || messageId === null || outboundIntentKey === null) {
    invalidRequest(context.response);
    return;
  }

  try {
    const repository = outboundRepository(context.dependencies.createRepository());
    const original = await repository.resolveRetryableMessage({
      shopId: context.shopId,
      messageId,
    });
    if (original === null) {
      sendJson(context.response, 404, { error: 'whatsapp_message_not_found' });
      return;
    }
    if (original.status !== 'FAILED') {
      sendJson(context.response, 409, { error: 'whatsapp_outbound_intent_conflict' });
      return;
    }
    const operator = await repository.resolveCurrentOperator({
      shopId: context.shopId,
      businessDayId: claims.businessDayId,
      workerId: claims.workerId,
    });
    if (operator === null) {
      sendJson(context.response, 409, { error: 'whatsapp_operator_not_synchronized' });
      return;
    }
    const policy = await repository.resolveMessagingPolicy({
      shopId: context.shopId,
      conversationId: original.conversationId,
    });
    if (
      policy.conversationId !== original.conversationId ||
      !freeFormOpen(policy.freeFormUntil, context.dependencies.now())
    ) {
      sendJson(context.response, 409, { error: 'whatsapp_free_form_window_closed' });
      return;
    }

    const channel = await outboundChannel(context.dependencies, context.shopId, context.response);
    if (channel === null) return;
    const claim = await repository.claimRetryIntent({
      shopId: context.shopId,
      businessDayId: claims.businessDayId,
      workerId: claims.workerId,
      deviceId: context.deviceId,
      messageId,
      outboundIntentKey,
      initiatedAt: context.dependencies.now().toISOString(),
    });
    if (!claim.created) {
      existingClaimResponse(context.response, claim.message);
      return;
    }

    let providerInput: Parameters<WhatsAppExtendedProviderGateway['sendMessage']>[0];
    if (claim.message.kind === 'TEXT' && claim.message.text !== null) {
      providerInput = {
        providerPhoneNumberId: channel.providerPhoneNumberId,
        to: claim.recipientNormalizedPhone,
        kind: 'TEXT',
        text: claim.message.text,
      };
    } else if (claim.message.kind === 'LOCATION' && claim.message.location !== null) {
      providerInput = {
        providerPhoneNumberId: channel.providerPhoneNumberId,
        to: claim.recipientNormalizedPhone,
        kind: 'LOCATION',
        ...claim.message.location,
      };
    } else if (
      (claim.message.kind === 'IMAGE' ||
        claim.message.kind === 'DOCUMENT' ||
        claim.message.kind === 'AUDIO') &&
      claim.message.media !== null
    ) {
      const media = await repository.resolveMediaAccess({ shopId: context.shopId, messageId });
      if (media === null || media.deletedAt !== null) {
        sendJson(context.response, 409, { error: 'whatsapp_media_expired' });
        return;
      }
      const access = await context.dependencies.createMediaStorage().createSignedDownload({
        objectPath: media.objectPath,
        expiresAt: media.expiresAt,
      });
      if (access.status !== 'AVAILABLE') {
        sendJson(context.response, 409, { error: 'whatsapp_media_expired' });
        return;
      }
      providerInput = {
        providerPhoneNumberId: channel.providerPhoneNumberId,
        to: claim.recipientNormalizedPhone,
        kind: claim.message.kind,
        mediaUrl: access.url,
        fileName: claim.message.media.fileName,
      };
    } else {
      sendJson(context.response, 409, { error: 'whatsapp_outbound_intent_conflict' });
      return;
    }

    await sendClaimedProviderMessage({
      repository,
      provider: context.dependencies.createProviderGateway(),
      providerInput,
      shopId: context.shopId,
      message: claim.message,
      response: context.response,
    });
  } catch (error) {
    if (!sendRepositoryError(context.response, error)) {
      sendJson(context.response, 503, { error: 'whatsapp_remote_unavailable' });
    }
  }
}

async function getMediaAccess(context: ActionContext): Promise<void> {
  if (!onlyKeys(context.body, ['action', 'messageId'])) {
    invalidRequest(context.response);
    return;
  }
  const messageId = parsedUuid(context.body['messageId']);
  if (messageId === null) {
    invalidRequest(context.response);
    return;
  }

  try {
    const repository = outboundRepository(context.dependencies.createRepository());
    const media = await repository.resolveMediaAccess({ shopId: context.shopId, messageId });
    if (media === null) {
      sendJson(context.response, 404, { error: 'whatsapp_media_not_found' });
      return;
    }
    if (
      media.deletedAt !== null ||
      !Number.isFinite(Date.parse(media.expiresAt)) ||
      Date.parse(media.expiresAt) <= context.dependencies.now().getTime()
    ) {
      sendJson(context.response, 200, {
        mediaAccess: { availability: 'EXPIRED', url: null, expiresAt: null },
      });
      return;
    }
    const access = await context.dependencies.createMediaStorage().createSignedDownload({
      objectPath: media.objectPath,
      expiresAt: media.expiresAt,
    });
    if (access.status === 'EXPIRED') {
      sendJson(context.response, 200, {
        mediaAccess: { availability: 'EXPIRED', url: null, expiresAt: null },
      });
      return;
    }
    sendJson(context.response, 200, {
      mediaAccess: {
        availability: 'AVAILABLE',
        url: access.url,
        expiresAt: access.urlExpiresAt,
      },
    });
  } catch (error) {
    if (!sendRepositoryError(context.response, error)) {
      sendJson(context.response, 503, { error: 'whatsapp_remote_unavailable' });
    }
  }
}

export async function handleWhatsAppOutboundAction(context: ActionContext): Promise<boolean> {
  if (!MEDIA_ACTIONS.has(context.action)) return false;
  if (context.action === 'CREATE_MEDIA_UPLOAD') await createMediaUpload(context);
  else if (context.action === 'FINALIZE_MEDIA_SEND') await finalizeMediaSend(context);
  else if (context.action === 'SEND_LOCATION') await sendLocation(context);
  else if (context.action === 'RETRY_FAILED') await retryFailed(context);
  else await getMediaAccess(context);
  return true;
}
