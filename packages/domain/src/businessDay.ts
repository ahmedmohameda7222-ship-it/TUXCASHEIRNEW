import { DomainInvariantError } from './errors';
import type { BusinessDayId, ShopId, WorkerId } from './ids';
import type { Instant } from './time';

export type { BusinessDayId } from './ids';

interface BusinessDayBase {
  readonly id: BusinessDayId;
  readonly shopId: ShopId;
  readonly startedAt: Instant;
  readonly startedByWorkerId: WorkerId;
  readonly lastAllocatedDisplayOrderNo: number;
}

export interface OpenBusinessDay extends BusinessDayBase {
  readonly status: 'OPEN';
  readonly endedAt: null;
  readonly endedByWorkerId: null;
}

export interface ClosedBusinessDay extends BusinessDayBase {
  readonly status: 'CLOSED';
  readonly endedAt: Instant;
  readonly endedByWorkerId: WorkerId;
}

export type BusinessDay = OpenBusinessDay | ClosedBusinessDay;

export function createOpenBusinessDay(
  input: Omit<OpenBusinessDay, 'status' | 'endedAt' | 'endedByWorkerId' | 'lastAllocatedDisplayOrderNo'>,
): OpenBusinessDay {
  return {
    ...input,
    status: 'OPEN',
    endedAt: null,
    endedByWorkerId: null,
    lastAllocatedDisplayOrderNo: 0,
  };
}

export function allocateDisplayOrderNo(day: OpenBusinessDay): {
  readonly businessDay: OpenBusinessDay;
  readonly displayOrderNo: number;
} {
  const next = day.lastAllocatedDisplayOrderNo + 1;
  if (!Number.isSafeInteger(next) || next <= 0) {
    throw new DomainInvariantError('Display order number allocation overflowed its safe range.');
  }
  return {
    displayOrderNo: next,
    businessDay: { ...day, lastAllocatedDisplayOrderNo: next },
  };
}

export function closeBusinessDay(
  day: OpenBusinessDay,
  endedAt: Instant,
  endedByWorkerId: WorkerId,
): ClosedBusinessDay {
  if (endedAt < day.startedAt) {
    throw new DomainInvariantError('A Business Day cannot end before it starts.');
  }
  return { ...day, status: 'CLOSED', endedAt, endedByWorkerId };
}
