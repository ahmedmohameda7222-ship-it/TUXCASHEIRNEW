import type { WhatsAppDataServerConfig } from './whatsappServerConfig';

export interface ExpiredWhatsAppMediaObject {
  readonly mediaKey: string;
  readonly bucketId: string;
  readonly objectPath: string;
}

export interface WhatsAppMediaRetentionRepository {
  listExpired(input: {
    readonly now: string;
    readonly limit: number;
  }): Promise<readonly ExpiredWhatsAppMediaObject[]>;
  markDeleted(input: { readonly mediaKey: string; readonly deletedAt: string }): Promise<unknown>;
}

export interface WhatsAppMediaRetentionStorage {
  deleteObject(input: {
    readonly bucketId: string;
    readonly objectPath: string;
  }): Promise<'DELETED' | 'NOT_FOUND' | 'FAILED'>;
}

export interface WhatsAppMediaRetentionHttpResult {
  readonly statusCode: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body: Readonly<Record<string, unknown>>;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

function record(value: unknown): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('WhatsApp media retention repository returned an invalid response.');
  }
  return value as UnknownRecord;
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('WhatsApp media retention repository returned an invalid response.');
  }
  return value.trim();
}

export class SupabaseWhatsAppMediaRetentionRepository implements WhatsAppMediaRetentionRepository {
  readonly #fetch: typeof fetch;

  constructor(
    private readonly config: WhatsAppDataServerConfig,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.#fetch = fetchImpl;
  }

  async #callRpc(functionName: string, body: UnknownRecord): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.config.projectUrl}/rest/v1/rpc/${functionName}`, {
        method: 'POST',
        headers: {
          apikey: this.config.serviceRoleKey,
          Authorization: `Bearer ${this.config.serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error('WhatsApp media retention repository is unavailable.');
    }
    if (!response.ok) throw new Error('WhatsApp media retention repository rejected the request.');
    try {
      const text = await response.text();
      return text === '' ? null : JSON.parse(text);
    } catch {
      throw new Error('WhatsApp media retention repository returned an invalid response.');
    }
  }

  async listExpired(input: {
    readonly now: string;
    readonly limit: number;
  }): Promise<readonly ExpiredWhatsAppMediaObject[]> {
    const payload = await this.#callRpc('list_tux_whatsapp_expired_media_v1', {
      p_now: input.now,
      p_limit: Math.min(Math.max(input.limit, 1), 100),
    });
    if (!Array.isArray(payload)) {
      throw new Error('WhatsApp media retention repository returned an invalid response.');
    }
    return payload.map((value) => {
      const row = record(value);
      return {
        mediaKey: requiredString(row['media_key']),
        bucketId: requiredString(row['bucket_id']),
        objectPath: requiredString(row['object_path']),
      };
    });
  }

  async markDeleted(input: { readonly mediaKey: string; readonly deletedAt: string }): Promise<void> {
    await this.#callRpc('mark_tux_whatsapp_media_deleted_v1', {
      p_media_key: input.mediaKey,
      p_deleted_at: input.deletedAt,
    });
  }
}

export async function runWhatsAppMediaRetention(input: {
  readonly repository: WhatsAppMediaRetentionRepository;
  readonly storage: WhatsAppMediaRetentionStorage;
  readonly now: string;
}): Promise<{ readonly scanned: number; readonly deleted: number; readonly failed: number }> {
  const expired = await input.repository.listExpired({ now: input.now, limit: 100 });
  let deleted = 0;
  let failed = 0;
  for (const media of expired.slice(0, 100)) {
    let outcome: 'DELETED' | 'NOT_FOUND' | 'FAILED';
    try {
      outcome = await input.storage.deleteObject({
        bucketId: media.bucketId,
        objectPath: media.objectPath,
      });
    } catch {
      outcome = 'FAILED';
    }
    if (outcome === 'FAILED') {
      failed += 1;
      continue;
    }
    await input.repository.markDeleted({ mediaKey: media.mediaKey, deletedAt: input.now });
    deleted += 1;
  }
  return { scanned: expired.length, deleted, failed };
}

export async function handleWhatsAppMediaRetentionRequest(input: {
  readonly method: string | undefined;
  readonly authorization: string | undefined;
  readonly cronSecret: string | undefined;
  readonly now: string;
  readonly runRetention: () => Promise<{
    readonly scanned: number;
    readonly deleted: number;
    readonly failed: number;
  }>;
}): Promise<WhatsAppMediaRetentionHttpResult> {
  if (input.method !== 'GET') {
    return {
      statusCode: 405,
      headers: { Allow: 'GET' },
      body: { error: 'method_not_allowed' },
    };
  }

  const secret = input.cronSecret?.trim() ?? '';
  if (secret === '') {
    return { statusCode: 503, body: { error: 'cron_secret_not_configured' } };
  }
  if (input.authorization !== `Bearer ${secret}`) {
    return { statusCode: 401, body: { error: 'unauthorized' } };
  }

  try {
    const result = await input.runRetention();
    return { statusCode: 200, body: result };
  } catch {
    return { statusCode: 503, body: { error: 'whatsapp_media_retention_unavailable' } };
  }
}
