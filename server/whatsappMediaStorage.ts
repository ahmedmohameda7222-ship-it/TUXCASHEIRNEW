import type { WhatsAppDataServerConfig } from './whatsappServerConfig';
import { WHATSAPP_MEDIA_BUCKET, WHATSAPP_MEDIA_RETENTION_MS } from './whatsappServerConfig';

export { WHATSAPP_MEDIA_BUCKET, WHATSAPP_MEDIA_RETENTION_MS };

const SIGNED_ACCESS_SECONDS = 5 * 60;

function segment(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

function absoluteUrl(projectUrl: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error('WhatsApp media storage request failed.');
  const url = new URL(value, projectUrl);
  if (url.origin !== new URL(projectUrl).origin)
    throw new Error('WhatsApp media storage request failed.');
  return url.toString();
}

export class SupabaseWhatsAppMediaStorage {
  readonly #fetch: typeof fetch;
  readonly #now: () => number;

  constructor(
    private readonly config: WhatsAppDataServerConfig,
    fetchImpl: typeof fetch = fetch,
    now: () => number = Date.now,
  ) {
    this.#fetch = fetchImpl;
    this.#now = now;
  }

  static objectPath(input: { readonly shopId: string; readonly mediaKey: string }): string | null {
    if (!segment(input.shopId) || !segment(input.mediaKey)) return null;
    return `media/${input.shopId}/${input.mediaKey}`;
  }

  static quarantineObjectPath(input: {
    readonly shopId: string;
    readonly mediaKey: string;
  }): string | null {
    if (!segment(input.shopId) || !segment(input.mediaKey)) return null;
    return `quarantine/${input.shopId}/${input.mediaKey}`;
  }

  #headers(): HeadersInit {
    return {
      apikey: this.config.serviceRoleKey,
      Authorization: `Bearer ${this.config.serviceRoleKey}`,
      'content-type': 'application/json',
    };
  }

  async createSignedUpload(input: {
    readonly shopId: string;
    readonly mediaKey: string;
    readonly fileName: string | null;
  }): Promise<{ readonly objectPath: string; readonly url: string }> {
    const objectPath = SupabaseWhatsAppMediaStorage.quarantineObjectPath(input);
    if (objectPath === null) throw new Error('WhatsApp media storage request failed.');
    const response = await this.#fetch(
      `${this.config.projectUrl}/storage/v1/object/upload/sign/${WHATSAPP_MEDIA_BUCKET}/${objectPath}`,
      { method: 'POST', headers: this.#headers(), body: '{}' },
    );
    if (!response.ok) throw new Error('WhatsApp media storage request failed.');
    const body = (await response.json()) as Record<string, unknown>;
    return {
      objectPath,
      url: absoluteUrl(this.config.projectUrl, body['url'] ?? body['signedURL']),
    };
  }

  async createSignedDownload(input: {
    readonly objectPath: string;
    readonly expiresAt: string;
  }): Promise<
    | { readonly status: 'EXPIRED' }
    | { readonly status: 'AVAILABLE'; readonly url: string; readonly urlExpiresAt: string }
  > {
    const now = this.#now();
    const logicalExpiry = Date.parse(input.expiresAt);
    if (!Number.isFinite(logicalExpiry) || logicalExpiry <= now) return { status: 'EXPIRED' };
    if (!input.objectPath.startsWith('media/') || input.objectPath.includes('..')) {
      throw new Error('WhatsApp media storage request failed.');
    }
    const seconds = Math.max(
      1,
      Math.min(SIGNED_ACCESS_SECONDS, Math.floor((logicalExpiry - now) / 1000)),
    );
    const response = await this.#fetch(
      `${this.config.projectUrl}/storage/v1/object/sign/${WHATSAPP_MEDIA_BUCKET}/${input.objectPath}`,
      { method: 'POST', headers: this.#headers(), body: JSON.stringify({ expiresIn: seconds }) },
    );
    if (!response.ok) throw new Error('WhatsApp media storage request failed.');
    const body = (await response.json()) as Record<string, unknown>;
    return {
      status: 'AVAILABLE',
      url: absoluteUrl(this.config.projectUrl, body['signedURL'] ?? body['url']),
      urlExpiresAt: new Date(now + seconds * 1000).toISOString(),
    };
  }

  async deleteObject(input: {
    readonly bucketId: string;
    readonly objectPath: string;
  }): Promise<'DELETED' | 'NOT_FOUND' | 'FAILED'> {
    if (input.bucketId !== WHATSAPP_MEDIA_BUCKET || input.objectPath.includes('..'))
      return 'FAILED';
    try {
      const response = await this.#fetch(
        `${this.config.projectUrl}/storage/v1/object/${input.bucketId}/${input.objectPath}`,
        { method: 'DELETE', headers: this.#headers() },
      );
      if (response.status === 404) return 'NOT_FOUND';
      return response.ok ? 'DELETED' : 'FAILED';
    } catch {
      return 'FAILED';
    }
  }
}
