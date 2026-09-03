import {
  parseWhatsAppInboxSnapshot,
  parseWhatsAppMessage,
  throwWhatsAppHttpError,
  WhatsAppRemoteError,
  type WhatsAppInboxSnapshot,
  type WhatsAppRemoteGateway,
} from '@tux/application';
import type { WhatsAppMessage } from '@tux/domain';
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
