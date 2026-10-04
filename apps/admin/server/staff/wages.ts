export type HourlyWageEstimateInput = {
  readonly regularMinutes: number;
  readonly overtimeMinutes: number;
  readonly hourlyMinor: number;
  readonly overtimeMultiplierBasisPoints: number;
};

export type MonthlyWageEstimateInput = {
  readonly monthlyMinor: number;
  readonly workedMinutes: number;
  readonly scheduledMinutes: number;
};

export type MonthlyWageEstimate = {
  readonly estimatedAmountMinor: number;
  readonly statutoryPayroll: false;
};

function nonNegativeInteger(value: number, code: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
  return BigInt(value);
}

function positiveInteger(value: number, code: string): bigint {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(code);
  return BigInt(value);
}

function roundedRatio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) throw new Error('invalid_wage_denominator');
  const rounded = (numerator + denominator / 2n) / denominator;
  const result = Number(rounded);
  if (!Number.isSafeInteger(result)) throw new Error('wage_estimate_overflow');
  return result;
}

export function estimateHourlyWage(input: HourlyWageEstimateInput): number {
  const regularMinutes = nonNegativeInteger(input.regularMinutes, 'invalid_regular_minutes');
  const overtimeMinutes = nonNegativeInteger(input.overtimeMinutes, 'invalid_overtime_minutes');
  const hourlyMinor = nonNegativeInteger(input.hourlyMinor, 'invalid_hourly_rate');
  const multiplierBasisPoints = positiveInteger(
    input.overtimeMultiplierBasisPoints,
    'invalid_overtime_multiplier',
  );

  const basis = 10_000n;
  const numerator =
    regularMinutes * hourlyMinor * basis + overtimeMinutes * hourlyMinor * multiplierBasisPoints;
  return roundedRatio(numerator, 60n * basis);
}

export function estimateMonthlyWage(input: MonthlyWageEstimateInput): MonthlyWageEstimate {
  const monthlyMinor = nonNegativeInteger(input.monthlyMinor, 'invalid_monthly_rate');
  const workedMinutes = nonNegativeInteger(input.workedMinutes, 'invalid_worked_minutes');
  const scheduledMinutes = nonNegativeInteger(input.scheduledMinutes, 'invalid_scheduled_minutes');

  if (scheduledMinutes === 0n) {
    return { estimatedAmountMinor: 0, statutoryPayroll: false };
  }

  const payableMinutes = workedMinutes > scheduledMinutes ? scheduledMinutes : workedMinutes;
  return {
    estimatedAmountMinor: roundedRatio(monthlyMinor * payableMinutes, scheduledMinutes),
    statutoryPayroll: false,
  };
}
