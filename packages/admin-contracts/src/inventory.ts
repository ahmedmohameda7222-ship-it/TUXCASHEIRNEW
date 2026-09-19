export interface InventoryBalance {
  readonly onHandMicros: number;
  readonly reservedMicros: number;
  readonly availableMicros: number;
}

export interface RecipeCostIngredient {
  readonly inventoryItemId: string;
  readonly quantityMicros: number;
  readonly unitCostMinor: number;
  readonly costMinor: number;
}

export interface RecipeCost {
  readonly totalMinor: number;
  readonly ingredients: readonly RecipeCostIngredient[];
}
