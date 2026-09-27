import { describe, expect, it } from 'vitest';

import { estimateHourlyWage, estimateMonthlyWage } from './wages';

describe('Workforce wage estimates', () => {
  it('estimates hourly wages in integer minor units with overtime', () => {
    expect(
      estimateHourlyWage({
        regularMinutes: 480,
        overtimeMinutes: 60,
        hourlyMinor: 5000,
        overtimeMultiplierBasisPoints: 15000,
      }),
    ).toBe(47500);
  });

  it('rounds only the final hourly estimate', () => {
    expect(
      estimateHourlyWage({
        regularMinutes: 61,
        overtimeMinutes: 0,
        hourlyMinor: 100,
        overtimeMultiplierBasisPoints: 15000,
      }),
    ).toBe(102);
  });

  it('prorates a monthly estimate using scheduled minutes and remains payroll-neutral', () => {
    expect(
      estimateMonthlyWage({
        monthlyMinor: 300000,
        workedMinutes: 9000,
        scheduledMinutes: 10800,
      }),
    ).toEqual({
      estimatedAmountMinor: 250000,
      statutoryPayroll: false,
    });
  });

  it('returns zero monthly estimate when no scheduled minutes exist', () => {
    expect(
      estimateMonthlyWage({
        monthlyMinor: 300000,
        workedMinutes: 0,
        scheduledMinutes: 0,
      }),
    ).toEqual({
      estimatedAmountMinor: 0,
      statutoryPayroll: false,
    });
  });
});
