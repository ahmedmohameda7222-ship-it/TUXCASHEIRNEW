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
import type { SupabaseDeviceSessionManager } from '@tux/sync';

export const TUX_OPERATIONS_API_ORIGIN_ENV = 'TUX_OPERATIONS_API_ORIGIN' as const;

export function parseTuxOperationsApiOrigin(raw: string): string {
  const value = raw.trim();
  if (value.length === 0) throw new TypeError('TUX Operations API origin is required.');
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new TypeError('TUX Operations API origin must use HTTPS.');
  if (url.username !== '' || url.password !== '') {
    throw new TypeError('TUX Operations API origin must not contain credentials.');
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new TypeError('TUX Operations API origin must not contain a path, query, or fragment.');
  }
  return url.origin;
}

type DeviceSessionSource = Pick<SupabaseDeviceSessionManager, 'resolveSession'>;

function responseObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('WhatsApp response must be an object.');
  }
  return value as Record<string, unknown>;
}

function responseString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value.trim();
}

function transientHttpsUrl(value: unknown, label: string): string {
  const raw = responseString(value, label);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new TypeError(`${label} is invalid.`);
  }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') {
    throw new TypeError(`${label} is invalid.`);
  }
  return parsed.toString();
}

function parseMediaUpload(value: unknown): {
  readonly mediaKey: string;
  readonly uploadUrl: string;
} {
  const source = responseObject(value);
  if (Object.keys(source).some((key) => key !== 'mediaKey' && key !== 'uploadUrl')) {
    throw new TypeError('WhatsApp media upload is invalid.');
  }
  const mediaKey = responseString(source['mediaKey'], 'WhatsApp media key');
  if (!/^[0-9a-f]{64}$/.test(mediaKey)) throw new TypeError('WhatsApp media key is invalid.');
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
    throw new TypeError('WhatsApp media access is invalid.');
  }
  if (source['availability'] === 'EXPIRED') {
    if (source['url'] !== null || source['expiresAt'] !== null) {
      throw new TypeError('WhatsApp media access is invalid.');
    }
    return { availability: 'EXPIRED', url: null, expiresAt: null };
  }
  if (source['availability'] !== 'AVAILABLE') {
    throw new TypeError('WhatsApp media access is invalid.');
  }
  const expiresAt = responseString(source['expiresAt'], 'WhatsApp media access expiry');
  if (!Number.isFinite(Date.parse(expiresAt))) {
    throw new TypeError('WhatsApp media access expiry is invalid.');
  }
  return {
    availability: 'AVAILABLE',
    url: transientHttpsUrl(source['url'], 'WhatsApp media access URL'),
    expiresAt,
  };
}

export class DesktopWhatsAppRemote implements WhatsAppRemoteGateway {
  readonly #apiOrigin: string;
  readonly #sessionManager: DeviceSessionSource;
  readonly #fetcher: typeof fetch;

  constructor(input: {
    readonly apiOrigin: string;
    readonly sessionManager: DeviceSessionSource;
    readonly fetcher?: typeof fetch;
  }) {
    this.#apiOrigin = parseTuxOperationsApiOrigin(input.apiOrigin);
    this.#sessionManager = input.sessionManager;
    this.#fetcher = input.fetcher ?? fetch;
  }

  async loadInbox(cursor?: string): Promise<WhatsAppInboxSnapshot> {
    const url = new URL('/api/whatsapp', this.#apiOrigin);
    if (cursor !== undefined) url.searchParams.set('after', cursor);
    return parseWhatsAppInboxSnapshot(await this.#request('GET', url));
  }

  async resolveMessagingTarget(
    input: Parameters<WhatsAppRemoteGateway['resolveMessagingTarget']>[0],
  ): Promise<WhatsAppMessagingTarget> {
    const payload = responseObject(
      await this.#request('POST', new URL('/api/whatsapp', this.#apiOrigin), {
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
      await this.#request('POST', new URL('/api/whatsapp', this.#apiOrigin), {
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
      await this.#request('POST', new URL('/api/whatsapp', this.#apiOrigin), {
        action: 'CREATE_MEDIA_UPLOAD',
        ...metadata,
      }),
    );
    const upload = parseMediaUpload(createPayload['upload']);
    await this.#uploadSignedMedia(upload.uploadUrl, input.media.mimeType, input.media.bytes);
    const finalizePayload = responseObject(
      await this.#request('POST', new URL('/api/whatsapp', this.#apiOrigin), {
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
      await this.#request('POST', new URL('/api/whatsapp', this.#apiOrigin), {
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
      await this.#request('POST', new URL('/api/whatsapp', this.#apiOrigin), {
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
      await this.#request('POST', new URL('/api/whatsapp', this.#apiOrigin), {
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
      await this.#request('POST', new URL('/api/whatsapp', this.#apiOrigin), {
        action: 'GET_MEDIA_ACCESS',
        messageId,
      }),
    );
    return parseMediaAccess(payload['mediaAccess']);
  }

  async markUnread(conversationId: string): Promise<void> {
    await this.#mutate({ action: 'MARK_UNREAD', conversationId });
  }

  async archive(conversationId: string, archived = true): Promise<void> {
    await this.#mutate({ action: 'ARCHIVE', conversationId, archived });
  }

  async setFollowUp(conversationId: string, followUp: boolean): Promise<void> {
    await this.#mutate({ action: 'FOLLOW_UP', conversationId, followUp });
  }

  async linkOrder(input: Parameters<WhatsAppRemoteGateway['linkOrder']>[0]): Promise<void> {
    await this.#mutate({
      action: 'LINK_ORDER',
      businessDayId: input.businessDayId,
      workerId: input.workerId,
      conversationId: input.conversationId,
      orderId: input.orderId,
      linked: input.linked ?? true,
    });
  }

  async #uploadSignedMedia(url: string, mimeType: string, bytes: Uint8Array): Promise<void> {
    let response: Response;
    try {
      response = await this.#fetcher(url, {
        method: 'PUT',
        headers: { 'Content-Type': mimeType },
        body: new Uint8Array(bytes),
      });
    } catch {
      throw new WhatsAppRemoteError('REMOTE_UNAVAILABLE', 'WhatsApp media upload is unavailable.');
    }
    if (!response.ok) {
      throw new WhatsAppRemoteError('REMOTE_UNAVAILABLE', 'WhatsApp media upload failed.');
    }
  }

  async #mutate(body: Readonly<Record<string, unknown>>): Promise<void> {
    await this.#request('POST', new URL('/api/whatsapp', this.#apiOrigin), body);
  }

  async #request(
    method: 'GET' | 'POST',
    url: URL,
    body?: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const resolution = await this.#sessionManager.resolveSession();
    let accessToken: string;
    let deviceId: string;
    switch (resolution.status) {
      case 'VALID':
        accessToken = resolution.session.accessToken;
        deviceId = resolution.session.deviceId;
        break;
      case 'TRANSPORT_UNAVAILABLE':
        throw new WhatsAppRemoteError('REMOTE_UNAVAILABLE', resolution.message);
      case 'NOT_ENROLLED':
      case 'AUTHORITATIVELY_INVALID':
        throw new WhatsAppRemoteError('DEVICE_AUTH_INVALID', resolution.message);
      case 'PROTOCOL_ERROR':
      case 'LOCAL_PERSISTENCE_ERROR':
        throw new Error(resolution.message);
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'x-tux-device-id': deviceId,
      Accept: 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await this.#fetcher(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new WhatsAppRemoteError('REMOTE_UNAVAILABLE', 'WhatsApp remote is unavailable.');
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error('WhatsApp remote returned invalid JSON.');
    }
    if (!response.ok) throwWhatsAppHttpError(response.status, payload);
    return payload;
  }
}
