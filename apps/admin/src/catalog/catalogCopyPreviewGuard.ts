export type CatalogCopyPreviewBinding = {
  sourceShopId: string;
  targetShopId: string;
  targetDraftId: string;
  expectedTargetPublishVersion: number;
  expectedTargetDraftRevision: number;
  selectedDomains: readonly string[];
};

export type CatalogCopyCurrentSelection = {
  sourceShopId: string;
  targetShopId: string;
  targetDraftId: string | null;
  targetPublishVersion: number;
  targetDraftRevision: number | null;
  selectedDomains: readonly string[];
};

/** Preview/apply is allowed only for the same source, target, draft, CAS and domains. */
export function catalogCopyPreviewMatchesSelection(
  preview: CatalogCopyPreviewBinding | null,
  current: CatalogCopyCurrentSelection,
): boolean {
  return (
    preview !== null &&
    current.targetDraftId !== null &&
    current.targetDraftRevision !== null &&
    current.sourceShopId !== current.targetShopId &&
    preview.sourceShopId === current.sourceShopId &&
    preview.targetShopId === current.targetShopId &&
    preview.targetDraftId === current.targetDraftId &&
    preview.expectedTargetPublishVersion === current.targetPublishVersion &&
    preview.expectedTargetDraftRevision === current.targetDraftRevision &&
    preview.selectedDomains.length === current.selectedDomains.length &&
    preview.selectedDomains.every((domain, index) => domain === current.selectedDomains[index])
  );
}
