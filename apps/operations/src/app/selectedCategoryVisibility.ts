export interface HorizontalBounds {
  readonly left: number;
  readonly right: number;
}

export function shouldEnsureSelectedCategoryVisible(
  rail: HorizontalBounds,
  selectedTab: HorizontalBounds,
): boolean {
  return selectedTab.left < rail.left || selectedTab.right > rail.right;
}
