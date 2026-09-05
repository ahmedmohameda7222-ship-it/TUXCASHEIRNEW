import {
  parseWhatsAppInboxSnapshot,
  parseWhatsAppMessage,
  parseWhatsAppMessagingTarget,
  throwWhatsAppHttpError,
  WhatsAppRemoteError,
  type WhatsAppInboxSnapshot,
  type WhatsAppMediaAccess,
  type WhatsAppRemoteGateway,
} from '@tux/application';
import type { WhatsAppMessage, WhatsAppMessagingTarget } from '@tux/domain';

function responseObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WhatsAppRemoteError(
      'REMOTE_UNAVAILABLE',
      'WhatsApp remote returned an invalid response.',
    );
  }
  return value as Record<string, unknown>;
}

function responseString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new WhatsAppRemoteError('REMOTE_UNAVAILABLE', `${label} is invalid.`);
  }
  return value.trim();
}

function transientHttpsUrl(value: unknown, label: string): string {
  const raw = responseString(value, label);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new WhatsAppRemoteError('REMOTE_UNAVAILABLE', `${label} is invalid.`);
  }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') {
    throw new WhatsAppRemoteError('REMOTE_UNAVAILABLE', `${label} is invalid.`);
  }
  return parsed.toString();
}

function parseMediaUpload(value: unknown): {
  readonly mediaKey: string;
  readonly uploadUrl: string;
} {
  const source = responseObject(value);
  if (Object.keys(source).some((key) => key !== 'mediaKey' && key !== 'uploadUrl')) {
    throw new WhatsAppRemoteError('REMOTE_UNAVAILABLE', 'WhatsApp media upload is invalid.');
  }
  const mediaKey = responseString(source['mediaKey'], 'WhatsApp media key');
  if (!/^[0-9a-f]{64}$/.test(mediaKey)) {
    throw new WhatsAppRemoteError('REMOTE_UNAVAILABLE', 'WhatsApp media key is invalid.');
  }
  return {
    mediaKey,
    uploadUrl: transientHttpsUrl(source['uploadUrl'], 'WhatsApp media upload URL'),
  };
}

function parseMediaAccess(value: unknown): WhatsAppMediaAccess {
  const source = responseObject(value);
  if (
    Object.keys(source).some(
      (key) => key !== 'availability' && key !== 'url' && key !== 'expiresAt',
    )
  ) {
    throw new WhatsAppRemoteError('REMOTE_UNAVAILABLE', 'WhatsApp media access is invalid.');
  }
  if (source['availability'] === 'EXPIRED') {
    if (source['url'] !== null || source['expiresAt'] !== null) {
      throw new WhatsAppRemoteError('REMOTE_UNAVAILABLE', 'WhatsApp media access is invalid.');
    }
    return { availability: 'EXPIRED', url: null, expiresAt: null };
  }
  if (source['availability'] !== 'AVAILABLE') {
    throw new WhatsAppRemoteError('REMOTE_UNAVAILABLE', 'WhatsApp media access is invalid.');
  }
  const expiresAt = responseString(source['expiresAt'], 'WhatsApp media access expiry');
  if (!Number.isFinite(Date.parse(expiresAt))) {
    throw new WhatsAppRemoteError('REMOTE_UNAVAILABLE', 'WhatsApp media access expiry is invalid.');
  }
  return {
    availability: 'AVAILABLE',
    url: transientHttpsUrl(source['url'], 'WhatsApp media access URL'),
    expiresAt,
  };
}

async function requestJson(
  method: 'GET' | 'POST',
  url: string,
  body?: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers:
        body === undefined
          ? { accept: 'application/json' }
          : { accept: 'application/json', 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new WhatsAppRemoteError('REMOTE_UNAVAILABLE', 'WhatsApp remote is unavailable.');
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new WhatsAppRemoteError(
      'REMOTE_UNAVAILABLE',
      'WhatsApp remote returned an invalid response.',
    );
  }

  if (!response.ok) throwWhatsAppHttpError(response.status, payload);
  return payload;
}

async function uploadSignedMedia(url: string, mimeType: string, bytes: Uint8Array): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      body: bytes,
    });
  } catch {
    throw new WhatsAppRemoteError('REMOTE_UNAVAILABLE', 'WhatsApp media upload is unavailable.');
  }
  if (!response.ok) {
    throw new WhatsAppRemoteError('REMOTE_UNAVAILABLE', 'WhatsApp media upload failed.');
  }
}

async function mutate(body: Readonly<Record<string, unknown>>): Promise<void> {
  await requestJson('POST', '/api/whatsapp', body);
}

export class VercelBrowserWhatsAppRemote implements WhatsAppRemoteGateway {
  async loadInbox(cursor?: string): Promise<WhatsAppInboxSnapshot> {
    const url =
      cursor === undefined ? '/api/whatsapp' : `/api/whatsapp?after=${encodeURIComponent(cursor)}`;
    return parseWhatsAppInboxSnapshot(await requestJson('GET', url));
  }

  async resolveMessagingTarget(
    input: Parameters<WhatsAppRemoteGateway['resolveMessagingTarget']>[0],
  ): Promise<WhatsAppMessagingTarget> {
    const payload = responseObject(
      await requestJson('POST', '/api/whatsapp', {
        action: 'RESOLVE_TARGET',
        normalizedPhone: input.normalizedPhone,
        displayPhone: input.displayPhone,
      }),
    );
    return parseWhatsAppMessagingTarget(payload['target']);
  }

  async sendText(
    input: Parameters<WhatsAppRemoteGateway['sendText']>[0],
  ): Promise<WhatsAppMessage> {
    const payload = responseObject(
      await requestJson('POST', '/api/whatsapp', {
        action: 'SEND_MESSAGE',
        businessDayId: input.businessDayId,
        workerId: input.workerId,
        conversationId: input.conversationId,
        outboundIntentKey: input.outboundIntentKey,
        text: input.text,
      }),
    );
    return parseWhatsAppMessage(payload['message']);
  }

  async sendMedia(
    input: Parameters<WhatsAppRemoteGateway['sendMedia']>[0],
  ): Promise<WhatsAppMessage> {
    const metadata = {
      businessDayId: input.businessDayId,
      workerId: input.workerId,
      conversationId: input.conversationId,
      outboundIntentKey: input.outboundIntentKey,
      kind: input.media.kind,
      mimeType: input.media.mimeType,
      fileName: input.media.fileName,
      byteSize: input.media.bytes.byteLength,
    } as const;
    const createPayload = responseObject(
      await requestJson('POST', '/api/whatsapp', {
        action: 'CREATE_MEDIA_UPLOAD',
        ...metadata,
      }),
    );
    const upload = parseMediaUpload(createPayload['upload']);
    await uploadSignedMedia(upload.uploadUrl, input.media.mimeType, input.media.bytes);
    const finalizePayload = responseObject(
      await requestJson('POST', '/api/whatsapp', {
        action: 'FINALIZE_MEDIA_SEND',
        ...metadata,
        mediaKey: upload.mediaKey,
      }),
    );
    return parseWhatsAppMessage(finalizePayload['message']);
  }

  async sendLocation(
    input: Parameters<WhatsAppRemoteGateway['sendLocation']>[0],
  ): Promise<WhatsAppMessage> {
    const payload = responseObject(
      await requestJson('POST', '/api/whatsapp', {
        action: 'SEND_LOCATION',
        businessDayId: input.businessDayId,
        workerId: input.workerId,
        conversationId: input.conversationId,
        outboundIntentKey: input.outboundIntentKey,
        latitude: input.location.latitude,
        longitude: input.location.longitude,
        name: input.location.name,
        address: input.location.address,
      }),
    );
    return parseWhatsAppMessage(payload['message']);
  }

  async sendTemplate(
    input: Parameters<WhatsAppRemoteGateway['sendTemplate']>[0],
  ): Promise<WhatsAppMessage> {
    const payload = responseObject(
      await requestJson('POST', '/api/whatsapp', {
        action: 'SEND_TEMPLATE',
        businessDayId: input.businessDayId,
        workerId: input.workerId,
        normalizedPhone: input.normalizedPhone,
        displayPhone: input.displayPhone,
        templateId: input.templateId,
        outboundIntentKey: input.outboundIntentKey,
      }),
    );
    return parseWhatsAppMessage(payload['message']);
  }

  async retryFailedMessage(
    input: Parameters<WhatsAppRemoteGateway['retryFailedMessage']>[0],
  ): Promise<WhatsAppMessage> {
    const payload = responseObject(
      await requestJson('POST', '/api/whatsapp', {
        action: 'RETRY_FAILED',
        businessDayId: input.businessDayId,
        workerId: input.workerId,
        messageId: input.messageId,
        outboundIntentKey: input.outboundIntentKey,
      }),
    );
    return parseWhatsAppMessage(payload['message']);
  }

  async getMediaAccess(messageId: string): Promise<WhatsAppMediaAccess> {
    const payload = responseObject(
      await requestJson('POST', '/api/whatsapp', { action: 'GET_MEDIA_ACCESS', messageId }),
    );
    return parseMediaAccess(payload['mediaAccess']);
  }

  async markUnread(conversationId: string): Promise<void> {
    await mutate({ action: 'MARK_UNREAD', conversationId });
  }

  async archive(conversationId: string, archived = true): Promise<void> {
    await mutate({ action: 'ARCHIVE', conversationId, archived });
  }

  async setFollowUp(conversationId: string, followUp: boolean): Promise<void> {
    await mutate({ action: 'FOLLOW_UP', conversationId, followUp });
  }

  async linkOrder(input: Parameters<WhatsAppRemoteGateway['linkOrder']>[0]): Promise<void> {
    await mutate({
      action: 'LINK_ORDER',
      businessDayId: input.businessDayId,
      workerId: input.workerId,
      conversationId: input.conversationId,
      orderId: input.orderId,
      linked: input.linked ?? true,
    });
  }
}
