export type ShopCopyPreviewContext = {
  sourceShopId: string;
  targetShopId: string;
  targetSettingsVersion: number;
  selectedDomains: readonly string[];
};

/** Reject a preview when the authorized shop scope or selected configuration changes. */
export function shopCopyPreviewMatchesSelection(
  preview: ShopCopyPreviewContext | null,
  current: ShopCopyPreviewContext,
): boolean {
  return (
    preview !== null &&
    current.sourceShopId !== current.targetShopId &&
    current.selectedDomains.length > 0 &&
    preview.sourceShopId === current.sourceShopId &&
    preview.targetShopId === current.targetShopId &&
    preview.targetSettingsVersion === current.targetSettingsVersion &&
    preview.selectedDomains.length === current.selectedDomains.length &&
    preview.selectedDomains.every((domain, index) => domain === current.selectedDomains[index])
  );
}
