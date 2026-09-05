import { createHash } from 'node:crypto';
import {
  validateWhatsAppMediaContent,
  WHATSAPP_MEDIA_LIMITS,
  type WhatsAppMediaKind,
} from './whatsappMediaPolicy';
import {
  SupabaseWhatsAppMediaStorage,
  WHATSAPP_MEDIA_BUCKET,
  WHATSAPP_MEDIA_RETENTION_MS,
} from './whatsappMediaStorage';
import type { WhatsAppDataServerConfig } from './whatsappServerConfig';

const VALIDATION_PREFIX_BYTES = 1024 * 1024;

export interface WhatsAppInspectedOutboundMedia {
  readonly objectPath: string;
  readonly prefix: Uint8Array;
  readonly byteSize: number;
  readonly sha256: string;
  readonly storedAt: string;
  readonly expiresAt: string;
}

export interface WhatsAppOutboundMediaStorage {
  createSignedUpload(input: {
    readonly shopId: string;
    readonly mediaKey: string;
    readonly fileName: string | null;
  }): Promise<{ readonly objectPath: string; readonly url: string }>;
  createSignedDownload(input: {
    readonly objectPath: string;
    readonly expiresAt: string;
  }): Promise<
    | { readonly status: 'EXPIRED' }
    | { readonly status: 'AVAILABLE'; readonly url: string; readonly urlExpiresAt: string }
  >;
  inspectUploadedMedia(input: {
    readonly shopId: string;
    readonly mediaKey: string;
    readonly kind: WhatsAppMediaKind;
    readonly mimeType: string;
    readonly byteSize: number;
  }): Promise<WhatsAppInspectedOutboundMedia>;
}

function encodedObjectUrl(
  config: WhatsAppDataServerConfig,
  objectPath: string,
): string {
  const encoded = objectPath.split('/').map(encodeURIComponent).join('/');
  return `${config.projectUrl}/storage/v1/object/${WHATSAPP_MEDIA_BUCKET}/${encoded}`;
}

async function readBoundedBody(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<{ readonly bytes: Uint8Array; readonly prefix: Uint8Array; readonly sha256: string }> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  const prefixChunks: Uint8Array[] = [];
  const hash = createHash('sha256');
  let total = 0;
  let prefixLength = 0;

  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (next.value.byteLength === 0) continue;
      total += next.value.byteLength;
      if (total > maxBytes) throw new Error('WhatsApp media exceeds the bounded upload limit.');
      chunks.push(next.value);
      hash.update(next.value);
      if (prefixLength < VALIDATION_PREFIX_BYTES) {
        const remaining = VALIDATION_PREFIX_BYTES - prefixLength;
        const piece =
          next.value.byteLength <= remaining ? next.value : next.value.slice(0, remaining);
        prefixChunks.push(piece);
        prefixLength += piece.byteLength;
      }
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const prefix = new Uint8Array(prefixLength);
  offset = 0;
  for (const chunk of prefixChunks) {
    prefix.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, prefix, sha256: hash.digest('hex') };
}

export class SupabaseWhatsAppOutboundMediaStorage
  extends SupabaseWhatsAppMediaStorage
  implements WhatsAppOutboundMediaStorage
{
  readonly #config: WhatsAppDataServerConfig;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;

  constructor(
    config: WhatsAppDataServerConfig,
    fetchImpl: typeof fetch = fetch,
    now: () => number = Date.now,
  ) {
    super(config, fetchImpl, now);
    this.#config = config;
    this.#fetch = fetchImpl;
    this.#now = now;
  }

  #headers(contentType?: string): HeadersInit {
    return {
      apikey: this.#config.serviceRoleKey,
      Authorization: `Bearer ${this.#config.serviceRoleKey}`,
      ...(contentType === undefined ? {} : { 'Content-Type': contentType }),
    };
  }

  async #delete(objectPath: string): Promise<void> {
    try {
      await this.#fetch(encodedObjectUrl(this.#config, objectPath), {
        method: 'DELETE',
        headers: this.#headers(),
      });
    } catch {
      // Quarantine cleanup is best-effort after canonical promotion.
    }
  }

  async inspectUploadedMedia(input: {
    readonly shopId: string;
    readonly mediaKey: string;
    readonly kind: WhatsAppMediaKind;
    readonly mimeType: string;
    readonly byteSize: number;
  }): Promise<WhatsAppInspectedOutboundMedia> {
    const quarantinePath = SupabaseWhatsAppMediaStorage.quarantineObjectPath(input);
    const objectPath = SupabaseWhatsAppMediaStorage.objectPath(input);
    if (quarantinePath === null || objectPath === null) {
      throw new Error('WhatsApp media storage request failed.');
    }
    if (
      !Number.isSafeInteger(input.byteSize) ||
      input.byteSize < 0 ||
      input.byteSize > WHATSAPP_MEDIA_LIMITS[input.kind]
    ) {
      throw new Error('WhatsApp media storage request failed.');
    }

    let sourcePath = quarantinePath;
    let response = await this.#fetch(encodedObjectUrl(this.#config, sourcePath), {
      method: 'GET',
      headers: this.#headers(),
    });
    if (response.status === 404) {
      sourcePath = objectPath;
      response = await this.#fetch(encodedObjectUrl(this.#config, sourcePath), {
        method: 'GET',
        headers: this.#headers(),
      });
    }
    if (!response.ok || response.body === null) {
      throw new Error('WhatsApp media storage request failed.');
    }

    const material = await readBoundedBody(response.body, WHATSAPP_MEDIA_LIMITS[input.kind]);
    if (material.bytes.byteLength !== input.byteSize) {
      if (sourcePath === quarantinePath) await this.#delete(quarantinePath);
      throw new Error('WhatsApp media storage request failed.');
    }
    const validation = validateWhatsAppMediaContent({
      kind: input.kind,
      mimeType: input.mimeType,
      byteSize: material.bytes.byteLength,
      prefix: material.prefix,
    });
    if (!validation.ok) {
      if (sourcePath === quarantinePath) await this.#delete(quarantinePath);
      throw new Error('WhatsApp media storage request failed.');
    }

    if (sourcePath === quarantinePath) {
      const promoted = await this.#fetch(encodedObjectUrl(this.#config, objectPath), {
        method: 'POST',
        headers: {
          ...this.#headers(input.mimeType),
          'x-upsert': 'true',
        },
        body: material.bytes,
      });
      if (!promoted.ok) throw new Error('WhatsApp media storage request failed.');
      await this.#delete(quarantinePath);
    }

    const storedAtMs = this.#now();
    return {
      objectPath,
      prefix: material.prefix,
      byteSize: material.bytes.byteLength,
      sha256: material.sha256,
      storedAt: new Date(storedAtMs).toISOString(),
      expiresAt: new Date(storedAtMs + WHATSAPP_MEDIA_RETENTION_MS).toISOString(),
    };
  }
}
