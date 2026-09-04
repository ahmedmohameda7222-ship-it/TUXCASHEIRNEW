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
