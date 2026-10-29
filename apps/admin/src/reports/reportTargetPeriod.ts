import { validReportDateRange } from './reportDateRange';

export function validReportTargetPeriod(from: string, to: string): boolean {
  return validReportDateRange(from, to);
}

export function matchingTargetForPeriod<
  T extends {
    readonly shopId: string;
    readonly metric: string;
    readonly periodStart: string;
    readonly periodEnd: string;
  },
>(targets: readonly T[], shopId: string, metric: string, from: string, to: string): T | undefined {
  return targets.find(
    (target) =>
      target.shopId === shopId &&
      target.metric === metric &&
      target.periodStart === from &&
      target.periodEnd === to,
  );
}
