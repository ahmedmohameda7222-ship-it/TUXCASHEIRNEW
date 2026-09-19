export type ReorderSuggestionInput = {
  readonly available: number;
  readonly par: number;
  readonly incoming: number;
  readonly minimumOrder?: number | null;
  readonly orderMultiple?: number | null;
};

export type InventoryUsageVariance = {
  readonly actualUsageMicros: number;
  readonly theoreticalUsageMicros: number;
  readonly varianceMicros: number;
  readonly variancePercent: number | null;
};

export type RecipeMarginIngredient = {
  readonly inventoryItemId: string;
  readonly name: string;
  readonly costMinor: number;
};

export type RecipeMarginContributor = RecipeMarginIngredient & {
  readonly sharePercent: number;
};

export type RecipeMarginAlert = {
  readonly recipeCostMinor: number;
  readonly currentCostPercent: number;
  readonly targetCostPercent: number;
  readonly overTargetPercentagePoints: number;
  readonly alert: boolean;
  readonly contributors: readonly RecipeMarginContributor[];
};

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite.`);
  return value;
}

function nonNegative(value: number, label: string): number {
  finite(value, label);
  if (value < 0) throw new RangeError(`${label} must be non-negative.`);
  return value;
}

function positiveOptional(value: number | null | undefined, label: string): number | null {
  if (value === null || value === undefined) return null;
  finite(value, label);
  if (value <= 0) throw new RangeError(`${label} must be positive when configured.`);
  return value;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function suggestOrderQuantity(input: ReorderSuggestionInput): number {
  const available = finite(input.available, 'available');
  const par = nonNegative(input.par, 'par');
  const incoming = nonNegative(input.incoming, 'incoming');
  const minimumOrder = positiveOptional(input.minimumOrder, 'minimumOrder');
  const orderMultiple = positiveOptional(input.orderMultiple, 'orderMultiple');

  const rawShortage = Math.max(0, par - available - incoming);
  if (rawShortage === 0) return 0;

  let suggested = Math.max(rawShortage, minimumOrder ?? 0);
  if (orderMultiple !== null) {
    suggested = Math.ceil(suggested / orderMultiple) * orderMultiple;
  }
  if (!Number.isFinite(suggested) || suggested < 0) {
    throw new RangeError('suggested order quantity is outside the supported numeric range.');
  }
  return suggested;
}

export function calculateInventoryUsageVariance(input: {
  readonly actualUsageMicros: number;
  readonly theoreticalUsageMicros: number;
}): InventoryUsageVariance {
  const actualUsageMicros = nonNegative(input.actualUsageMicros, 'actualUsageMicros');
  const theoreticalUsageMicros = nonNegative(
    input.theoreticalUsageMicros,
    'theoreticalUsageMicros',
  );
  const varianceMicros = actualUsageMicros - theoreticalUsageMicros;
  return {
    actualUsageMicros,
    theoreticalUsageMicros,
    varianceMicros,
    variancePercent:
      theoreticalUsageMicros === 0
        ? null
        : round2((varianceMicros / theoreticalUsageMicros) * 100),
  };
}

export function calculateRecipeMarginAlert(input: {
  readonly sellingPriceMinor: number;
  readonly targetCostPercent: number;
  readonly alertThresholdPercentagePoints: number;
  readonly ingredients: readonly RecipeMarginIngredient[];
}): RecipeMarginAlert {
  const sellingPriceMinor = finite(input.sellingPriceMinor, 'sellingPriceMinor');
  if (sellingPriceMinor <= 0) {
    throw new RangeError('sellingPriceMinor must be positive.');
  }
  const targetCostPercent = nonNegative(input.targetCostPercent, 'targetCostPercent');
  const alertThresholdPercentagePoints = nonNegative(
    input.alertThresholdPercentagePoints,
    'alertThresholdPercentagePoints',
  );

  const normalizedIngredients = input.ingredients.map((ingredient) => ({
    ...ingredient,
    costMinor: nonNegative(ingredient.costMinor, `ingredient ${ingredient.inventoryItemId} cost`),
  }));
  const recipeCostMinor = normalizedIngredients.reduce(
    (total, ingredient) => total + ingredient.costMinor,
    0,
  );
  const currentCostPercent = round2((recipeCostMinor / sellingPriceMinor) * 100);
  const overTargetPercentagePoints = round2(currentCostPercent - targetCostPercent);

  const contributors = [...normalizedIngredients]
    .sort(
      (left, right) =>
        right.costMinor - left.costMinor ||
        left.inventoryItemId.localeCompare(right.inventoryItemId),
    )
    .map((ingredient) => ({
      ...ingredient,
      sharePercent:
        recipeCostMinor === 0 ? 0 : round2((ingredient.costMinor / recipeCostMinor) * 100),
    }));

  return {
    recipeCostMinor,
    currentCostPercent,
    targetCostPercent,
    overTargetPercentagePoints,
    alert: overTargetPercentagePoints >= alertThresholdPercentagePoints,
    contributors,
  };
}
