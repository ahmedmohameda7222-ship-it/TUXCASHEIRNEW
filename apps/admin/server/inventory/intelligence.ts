export type ReorderSuggestionInput = {
  readonly available: number;
  readonly par: number;
  readonly incoming: number;
  readonly minimumOrder?: number | null;
  readonly orderMultiple?: number | null;
};

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite non-negative number.`);
  }
  return value;
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite.`);
  }
  return value;
}

function optionalPositive(value: number | null | undefined, label: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite positive number when configured.`);
  }
  return value;
}

export function suggestOrderQuantity(input: ReorderSuggestionInput): number {
  const available = finite(input.available, 'available');
  const par = finiteNonNegative(input.par, 'par');
  const incoming = finiteNonNegative(input.incoming, 'incoming');
  const minimumOrder = optionalPositive(input.minimumOrder, 'minimum order');
  const orderMultiple = optionalPositive(input.orderMultiple, 'order multiple');

  const shortage = Math.max(0, par - available - incoming);
  if (shortage === 0) return 0;

  let suggestion = minimumOrder === null ? shortage : Math.max(shortage, minimumOrder);
  if (orderMultiple !== null) {
    suggestion = Math.ceil(suggestion / orderMultiple) * orderMultiple;
  }
  return suggestion;
}

export function calculateActualVsTheoretical(input: {
  readonly actualUsageMicros: number;
  readonly theoreticalUsageMicros: number;
}): {
  readonly actualUsageMicros: number;
  readonly theoreticalUsageMicros: number;
  readonly varianceMicros: number;
  readonly variancePercent: number | null;
} {
  const actualUsageMicros = finiteNonNegative(input.actualUsageMicros, 'actual usage');
  const theoreticalUsageMicros = finiteNonNegative(
    input.theoreticalUsageMicros,
    'theoretical usage',
  );
  const varianceMicros = actualUsageMicros - theoreticalUsageMicros;
  const variancePercent =
    theoreticalUsageMicros === 0 ? null : (varianceMicros / theoreticalUsageMicros) * 100;
  return {
    actualUsageMicros,
    theoreticalUsageMicros,
    varianceMicros,
    variancePercent,
  };
}

export type FoodCostIngredient = {
  readonly inventoryItemId: string;
  readonly itemName: string;
  readonly costMinor: number;
};

export function calculateFoodCostMarginAlert(input: {
  readonly productPriceMinor: number;
  readonly targetFoodCostPercent: number;
  readonly alertThresholdPercent: number;
  readonly ingredients: readonly FoodCostIngredient[];
}): {
  readonly recipeCostMinor: number;
  readonly foodCostPercent: number;
  readonly targetFoodCostPercent: number;
  readonly alertThresholdPercent: number;
  readonly alert: boolean;
  readonly largestContributor: FoodCostIngredient | null;
} {
  const productPriceMinor = finiteNonNegative(input.productPriceMinor, 'product price');
  if (productPriceMinor === 0) {
    throw new RangeError('product price must be greater than zero.');
  }
  const targetFoodCostPercent = finiteNonNegative(
    input.targetFoodCostPercent,
    'target food cost percent',
  );
  const alertThresholdPercent = finiteNonNegative(
    input.alertThresholdPercent,
    'alert food cost percent',
  );
  if (targetFoodCostPercent > 100 || alertThresholdPercent > 100) {
    throw new RangeError('food cost percentages cannot exceed 100.');
  }
  if (alertThresholdPercent < targetFoodCostPercent) {
    throw new RangeError('alert food cost percent cannot be below the target.');
  }

  const ingredients = input.ingredients.map((ingredient) => ({
    ...ingredient,
    costMinor: finiteNonNegative(ingredient.costMinor, 'ingredient cost'),
  }));
  const recipeCostMinor = ingredients.reduce(
    (total, ingredient) => total + ingredient.costMinor,
    0,
  );
  const foodCostPercent = (recipeCostMinor / productPriceMinor) * 100;
  const largestContributor =
    ingredients.length === 0
      ? null
      : ingredients.reduce((largest, ingredient) =>
          ingredient.costMinor > largest.costMinor ? ingredient : largest,
        );

  return {
    recipeCostMinor,
    foodCostPercent,
    targetFoodCostPercent,
    alertThresholdPercent,
    alert: foodCostPercent >= alertThresholdPercent,
    largestContributor,
  };
}
