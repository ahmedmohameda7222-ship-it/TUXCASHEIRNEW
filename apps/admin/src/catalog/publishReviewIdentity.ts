import type { CatalogPublishPreview } from '@tux/admin-contracts';

/** Order-independent representation of the exact server-rendered preview. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function publishReviewIdentity(shopId: string, preview: CatalogPublishPreview): string {
  return canonical({
    shopId,
    draftId: preview.draftId,
    draftRevision: preview.draftRevision,
    currentPublishVersion: preview.currentPublishVersion,
    previewFingerprint: canonical(preview),
  });
}
